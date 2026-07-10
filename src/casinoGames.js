import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildId } from './interactionRouter.js';
import { cash, compact, GREEN, RED, GOLD, polish } from './utils.js';
import { ensureUser, adjust } from './casinoLib.js';
import {
  recordGame, casinoProgressField,
  jackpotPool, contributeJackpot, awardJackpot,
} from './casinoStats.js';

// ── Shared instant-game engine ────────────────────────────────────────────────
// Single source of truth for coinflip / slots / roulette so the slash command
// and the one-tap "Play Again" button always produce identical results. Each
// play*() runs the full settle (escrow → outcome → payout → recordGame) and
// returns a ready-to-send { embeds, components } payload.

// ── One-tap rebet controls ────────────────────────────────────────────────────
// customId: again:<game>:<ownerId>:<bet>:<...params>  (router enforces ownership).
export function againRow(game, ownerId, bet, ...params) {
  const p = params.map(String);
  const dbl = bet * 2;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('again', game, ownerId, String(bet), ...p))
      .setLabel(`🔄 Again · ${compact(bet)}`).setStyle(ButtonStyle.Primary),
  );
  // Offer a one-tap "Double" escalation (the classic loss-chase lever), unless
  // it would obviously overflow the cap.
  if (dbl <= 1_000_000) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('again', game, ownerId, String(dbl), ...p))
        .setLabel(`⏫ Double · ${compact(dbl)}`).setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

// ── Coinflip ──────────────────────────────────────────────────────────────────
export function playCoinflip(guildId, user, bet, side, interaction) {
  adjust(guildId, user.id, -bet);
  const flip = Math.random() < 0.5 ? 'heads' : 'tails';
  const won  = flip === side;
  if (won) adjust(guildId, user.id, bet * 2);
  const settle = recordGame({ guildId, userId: user.id, bet, net: won ? bet : -bet, game: 'coinflip' });
  const bal    = ensureUser(guildId, user.id).balance;

  const embed = new EmbedBuilder()
    .setTitle(`🪙 Coinflip — ${flip === 'heads' ? '👑 Heads' : '🪙 Tails'}`)
    .setColor(won ? GREEN : RED)
    .addFields(
      { name: 'You called', value: side === 'heads' ? '👑 Heads' : '🪙 Tails', inline: true },
      { name: won ? 'Won' : 'Lost', value: cash(bet), inline: true },
      { name: 'Balance', value: cash(bal), inline: true },
    );
  const f = casinoProgressField(settle); if (f) embed.addFields(f);
  polish(embed, interaction);
  return { embeds: [embed], components: [againRow('coinflip', user.id, bet, side)] };
}

// ── Slots ───────────────────────────────────────────────────────────────────
const REEL = [
  { e: '🍒', w: 30, m: 3  },
  { e: '🍋', w: 25, m: 4  },
  { e: '🔔', w: 20, m: 6  },
  { e: '⭐', w: 13, m: 10 },
  { e: '💎', w: 8,  m: 20 },
  { e: '7️⃣', w: 4,  m: 50 },
];
const TOTAL_W = REEL.reduce((s, x) => s + x.w, 0);
function spin() {
  let r = Math.random() * TOTAL_W;
  for (const x of REEL) if ((r -= x.w) < 0) return x;
  return REEL[0];
}

export function playSlots(guildId, user, bet, interaction) {
  adjust(guildId, user.id, -bet);
  contributeJackpot(guildId, bet);

  const reels = [spin(), spin(), spin()];
  const line  = reels.map(r => r.e).join(' │ ');

  let gross = 0, note = 'No win — better luck next spin!', jackpotHit = false, mult = 0, nearMiss = false;
  if (reels[0].e === reels[1].e && reels[1].e === reels[2].e) {
    mult  = reels[0].m;
    gross = Math.round(bet * mult);
    if (reels[0].e === '7️⃣') {
      jackpotHit = true;
      const pool = awardJackpot(guildId);
      gross += Math.round(pool);
      note = `🎰 **JACKPOT!!!** Triple 7s win the ${cash(pool)} pool!`;
    } else {
      note = `Three ${reels[0].e} — ${mult}×!`;
    }
  } else {
    const cherries = reels.filter(r => r.e === '🍒').length;
    if (cherries === 2) { gross = Math.round(bet * 2); mult = 2; note = 'Two 🍒 — 2×!'; }
    // Near-miss juice: two-of-a-kind that didn't pay reads as "so close".
    else if (reels[0].e === reels[1].e || reels[1].e === reels[2].e || reels[0].e === reels[2].e) {
      nearMiss = true; note = '😬 So close — two of a kind! Spin again?';
    }
  }

  const won = gross > 0;
  const settle = recordGame({ guildId, userId: user.id, bet, net: gross - bet, game: 'slots', flags: { jackpot: jackpotHit, mult } });
  const bal    = ensureUser(guildId, user.id).balance;
  const net    = gross - bet;

  // Escalating win celebration: bigger multipliers get louder.
  const title = jackpotHit ? '🎰💥 SLOTS — JACKPOT!'
    : mult >= 20 ? '🎰🤑 SLOTS — HUGE WIN!'
    : mult >= 6  ? '🎰🔥 SLOTS — Big Win!'
    : '🎰 Slots';
  const color = won ? GREEN : nearMiss ? GOLD : RED;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(`**${line}**\n\n${note}`)
    .addFields(
      { name: 'Bet',                value: cash(bet),                         inline: true },
      { name: won ? 'Won' : 'Lost', value: won ? cash(net) : cash(bet),       inline: true },
      { name: 'Balance',            value: cash(bal),                         inline: true },
    )
    .setFooter({ text: `💰 Jackpot pool: ${cash(jackpotPool(guildId))}` });
  const f = casinoProgressField(settle); if (f) embed.addFields(f);
  polish(embed, interaction);
  return { embeds: [embed], components: [againRow('slots', user.id, bet)] };
}

// ── Roulette ──────────────────────────────────────────────────────────────────
const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const rColor = n => n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black';
const R_EMOJI = { red: '🔴', black: '⚫', green: '🟢' };

export function parseSpace(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['red','black','green','even','odd','low','high'].includes(s)) return { kind: 'outside', value: s };
  const n = parseInt(s, 10);
  if (Number.isInteger(n) && n >= 0 && n <= 36 && String(n) === s) return { kind: 'number', value: n };
  return null;
}

// Gross return multiplier (incl. stake) if the bet wins, else 0.
function payoutMult(bet, result) {
  const c = rColor(result);
  if (bet.kind === 'number') return bet.value === result ? 36 : 0;
  switch (bet.value) {
    case 'red':   case 'black': return c === bet.value ? 2 : 0;
    case 'green': return c === 'green' ? 36 : 0;
    case 'even':  return result !== 0 && result % 2 === 0 ? 2 : 0;
    case 'odd':   return result !== 0 && result % 2 === 1 ? 2 : 0;
    case 'low':   return result >= 1  && result <= 18 ? 2 : 0;
    case 'high':  return result >= 19 && result <= 36 ? 2 : 0;
    default:      return 0;
  }
}

export function playRoulette(guildId, user, bet, space, interaction) {
  adjust(guildId, user.id, -bet);
  const result = Math.floor(Math.random() * 37);
  const mult   = payoutMult(space, result);
  const gross  = Math.round(bet * mult);
  if (gross > 0) adjust(guildId, user.id, gross);
  const settle = recordGame({ guildId, userId: user.id, bet, net: gross - bet, game: 'roulette' });
  const bal    = ensureUser(guildId, user.id).balance;
  const net    = gross - bet;
  const won    = gross > 0;
  const pick   = space.kind === 'number' ? `#${space.value}` : space.value;
  const spaceArg = space.kind === 'number' ? String(space.value) : space.value;

  const embed = new EmbedBuilder()
    .setTitle(`🎡 Roulette — ${R_EMOJI[rColor(result)]} ${result} (${rColor(result)})`)
    .setColor(won ? GREEN : RED)
    .addFields(
      { name: 'Your bet', value: `${cash(bet)} on **${pick}**`, inline: true },
      { name: won ? 'Won' : 'Lost', value: won ? cash(net) : cash(bet), inline: true },
      { name: 'Balance', value: cash(bal), inline: true },
    );
  const f = casinoProgressField(settle); if (f) embed.addFields(f);
  polish(embed, interaction);
  return { embeds: [embed], components: [againRow('roulette', user.id, bet, spaceArg)] };
}

// Dispatch table for the rebet handler.
export const REBET = {
  coinflip: (g, u, bet, params, it) => playCoinflip(g, u, bet, params[0], it),
  slots:    (g, u, bet, _params, it) => playSlots(g, u, bet, it),
  roulette: (g, u, bet, params, it) => {
    const space = parseSpace(params[0]);
    if (!space) return null;
    return playRoulette(g, u, bet, space, it);
  },
};
