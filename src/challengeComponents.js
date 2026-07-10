import { EmbedBuilder } from 'discord.js';
import { registerComponent } from './interactionRouter.js';
import { errorEmbed, cash, GOLD, polish } from './utils.js';
import { acceptChallenge, declineChallenge, duelResultEmbed } from './challengeEngine.js';

// ── Duel Accept / Decline handler ─────────────────────────────────────────────
// customId: duel:<accept|decline>:<opponentId>:<challengeId>
// The router already restricts these controls to the challenged opponent
// (ownerId slot). All payouts go through the atomic engine in challengeEngine.js.

function acceptReason(reason) {
  switch (reason) {
    case 'opponent-broke': return "You can't afford to accept this challenge.";
    case 'expired':        return 'This challenge has expired.';
    default:               return 'This challenge is no longer open.';
  }
}

registerComponent('duel', async (interaction, { action, args }) => {
  const id = Number(args[0]);
  const { user } = interaction;

  if (action === 'accept') {
    const r = acceptChallenge({ id, byUserId: user.id });
    if (!r.ok) return interaction.reply({ embeds: [errorEmbed(acceptReason(r.reason))], ephemeral: true }).catch(() => {});
    return interaction.update({ embeds: [duelResultEmbed(r, interaction)], components: [] }).catch(() => {});
  }

  if (action === 'decline') {
    const r = declineChallenge({ id });
    if (!r.ok) return interaction.reply({ embeds: [errorEmbed('This challenge is no longer open.')], ephemeral: true }).catch(() => {});
    const embed = polish(new EmbedBuilder()
      .setTitle('🏳️ Challenge Declined')
      .setColor(GOLD)
      .setDescription(`<@${user.id}> declined. <@${r.challenge.challenger_id}>'s ${cash(r.challenge.bet)} stake was refunded.`), interaction);
    return interaction.update({ embeds: [embed], components: [] }).catch(() => {});
  }

  return interaction.reply({ embeds: [errorEmbed('Unknown duel action.')], ephemeral: true }).catch(() => {});
});
