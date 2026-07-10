import { registerComponent } from './interactionRouter.js';
import { errorEmbed } from './utils.js';
import { ValidationError } from './validate.js';
import { ensureUser, validateBet } from './casinoLib.js';
import { REBET } from './casinoGames.js';

// ── One-tap "Play Again" / "Double" handler ───────────────────────────────────
// customId (via the 'again' namespace):  again:<game>:<ownerId>:<bet>:<...params>
// The router has already verified the clicker owns these controls (ownerId slot).
//
// EXPLOIT GUARD: ensureUser → validateBet → the full game settle (which debits
// the stake) all run SYNCHRONOUSLY before the first await. Because bun:sqlite is
// synchronous and JS is single-threaded, two rapid clicks can't interleave
// between the balance read and the debit, so there's no free-spin race.
registerComponent('again', async (interaction, { action: game, ownerId, args }) => {
  const [betStr, ...params] = args;
  const bet = Number(betStr);
  const { guildId, user } = interaction;

  const play = REBET[game];
  if (!play) return interaction.reply({ embeds: [errorEmbed('This game can no longer be replayed here.')], ephemeral: true }).catch(() => {});

  let payload;
  try {
    const dbUser = ensureUser(guildId, user.id);
    const stake  = validateBet(bet, dbUser.balance);       // throws if unaffordable / out of range
    payload = play(guildId, user, stake, params, interaction); // debits + settles, all synchronous
  } catch (err) {
    if (err instanceof ValidationError) {
      return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true }).catch(() => {});
    }
    console.error('[again] rebet failed:', err);
    return interaction.reply({ embeds: [errorEmbed('Something went wrong replaying that game.')], ephemeral: true }).catch(() => {});
  }

  if (!payload) return interaction.reply({ embeds: [errorEmbed('Could not replay that game.')], ephemeral: true }).catch(() => {});
  // Replace the previous result in place — keeps the channel tidy and the loop tight.
  await interaction.update(payload).catch(() => {});
});
