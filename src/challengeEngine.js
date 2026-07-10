import { EmbedBuilder } from 'discord.js';
import { stmt } from './db.js';
import { ensureUser, adjust, makeDeck } from './casinoLib.js';
import { ValidationError } from './validate.js';
import { awardXp } from './postTrade.js';
import { xpForBet } from './progression.js';
import { progressQuests } from './quests.js';
import { cash, GREEN, GOLD, polish } from './utils.js';

// ── PvP Challenge Duels ───────────────────────────────────────────────────────
// The only fully zero-sum mode: 2·bet in, 2·bet out to the winner — no coins are
// minted, so no inflation. Every escrow / status transition is an atomic guarded
// UPDATE that acts only when exactly one row changes, so double-clicked Accepts,
// accept-vs-expiry races, and post-restart replays can never double-pay.

export const CHALLENGE_TTL = 300; // seconds a challenge stays open

const RANK_VAL = { A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

/** Escrow the challenger's stake and open a pending challenge. Throws ValidationError. */
export function createChallenge({ guildId, channelId, challengerId, opponentId, bet, game = 'highcard' }) {
  ensureUser(guildId, challengerId);
  if (stmt.debitIfEnough.run(bet, guildId, challengerId, bet).changes !== 1) {
    throw new ValidationError(`You can't afford a ${cash(bet)} challenge.`);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_TTL;
  const info = stmt.insertChallenge.run(guildId, channelId ?? null, challengerId, opponentId, bet, game, expiresAt);
  return { id: Number(info.lastInsertRowid), expiresAt };
}

function resolve(ch) {
  if (ch.game === 'coinflip') {
    const challengerWins = Math.random() < 0.5;
    return { winnerId: challengerWins ? ch.challenger_id : ch.opponent_id };
  }
  // High-card draw — redraw on a tie so there's always a decisive winner.
  let c, o;
  do { const deck = makeDeck(); c = deck.pop(); o = deck.pop(); } while (RANK_VAL[c.r] === RANK_VAL[o.r]);
  return { winnerId: RANK_VAL[c.r] > RANK_VAL[o.r] ? ch.challenger_id : ch.opponent_id, cCard: c, oCard: o };
}

/** Opponent accepts. Escrows the opponent, resolves, and pays the winner 2·bet. */
export function acceptChallenge({ id, byUserId }) {
  const ch = stmt.getChallenge.get(id);
  if (!ch)                                              return { ok: false, reason: 'gone' };
  if (ch.status !== 'pending')                          return { ok: false, reason: 'closed' };
  if (ch.opponent_id !== byUserId)                      return { ok: false, reason: 'not-yours' };
  if (Math.floor(Date.now() / 1000) >= ch.expires_at)   return { ok: false, reason: 'expired' };

  // Atomically claim the accept — only one caller wins the pending→accepted flip.
  if (stmt.acceptChallenge.run(id).changes !== 1)       return { ok: false, reason: 'closed' };

  ensureUser(ch.guild_id, ch.opponent_id);
  // Escrow the opponent; if they can't afford it, refund the challenger and void.
  if (stmt.debitIfEnough.run(ch.bet, ch.guild_id, ch.opponent_id, ch.bet).changes !== 1) {
    stmt.finishChallenge.run(null, id);            // accepted→done (voided)
    adjust(ch.guild_id, ch.challenger_id, ch.bet); // return the challenger's escrow
    return { ok: false, reason: 'opponent-broke' };
  }

  const { winnerId, cCard, oCard } = resolve(ch);
  // Atomically finish — guards against any second settlement path.
  if (stmt.finishChallenge.run(winnerId, id).changes !== 1) return { ok: false, reason: 'closed' };

  const pot     = ch.bet * 2;
  const loserId = winnerId === ch.challenger_id ? ch.opponent_id : ch.challenger_id;
  adjust(ch.guild_id, winnerId, pot);

  let wxp = {};
  try { wxp = awardXp(ch.guild_id, winnerId, xpForBet(ch.bet)); awardXp(ch.guild_id, loserId, xpForBet(ch.bet)); } catch (e) { console.warn('[duel] xp:', e?.message); }
  try {
    progressQuests({ guildId: ch.guild_id, userId: winnerId, game: 'duel', bet: ch.bet, net: ch.bet,  win: true });
    progressQuests({ guildId: ch.guild_id, userId: loserId,  game: 'duel', bet: ch.bet, net: -ch.bet, win: false });
  } catch (e) { console.warn('[duel] quests:', e?.message); }

  return { ok: true, challenge: ch, winnerId, loserId, pot, cCard, oCard, wxp };
}

/** Opponent declines — refund the challenger. */
export function declineChallenge({ id }) {
  const ch = stmt.getChallenge.get(id);
  if (!ch || ch.status !== 'pending') return { ok: false };
  if (stmt.cancelChallenge.run('declined', id).changes !== 1) return { ok: false };
  adjust(ch.guild_id, ch.challenger_id, ch.bet);
  return { ok: true, challenge: ch };
}

/** Poller tick + startup: refund & cancel any pending challenge past its expiry. */
export async function sweepExpiredChallenges(client) {
  const now = Math.floor(Date.now() / 1000);
  const expired = stmt.getExpiredChallenges.all(now);
  for (const ch of expired) {
    if (stmt.cancelChallenge.run('cancelled', ch.id).changes !== 1) continue; // accepted/declined first
    adjust(ch.guild_id, ch.challenger_id, ch.bet); // refund escrow — never leave coins stuck
    if (ch.channel_id && client) {
      const embed = polish(new EmbedBuilder().setTitle('⌛ Challenge Expired').setColor(GOLD)
        .setDescription(`<@${ch.opponent_id}> didn't respond — <@${ch.challenger_id}>'s ${cash(ch.bet)} stake was refunded.`));
      client.channels.fetch(ch.channel_id)
        .then(c => (c?.isTextBased() ? c.send({ embeds: [embed] }) : null))
        .catch(() => {});
    }
  }
}

// ── Result embed (built here so the command + button render identically) ──────
export function duelResultEmbed(r, interaction) {
  const { challenge: ch, winnerId, cCard, oCard, pot } = r;
  const cards = (cCard && oCard)
    ? `\n<@${ch.challenger_id}> drew **${cCard.r}${cCard.s}** · <@${ch.opponent_id}> drew **${oCard.r}${oCard.s}**`
    : '';
  return polish(new EmbedBuilder()
    .setTitle('⚔️ Duel Result')
    .setColor(GREEN)
    .setDescription(`🏆 <@${winnerId}> wins **${cash(pot)}**!${cards}`), interaction);
}
