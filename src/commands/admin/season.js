import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { stmt, getConfig, resetSeason } from '../../db.js';
import { cash, brandEmbed, GOLD, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('season')
    .setDescription('View or manage the trading season')
    .setDMPermission(false)
    .addSubcommand(s => s.setName('info').setDescription('Show the current season and last winners'))
    .addSubcommand(s =>
      s.setName('reset')
        .setDescription('End the season, crown winners, and reset everyone (Manage Server only)')
        .addBooleanOption(o => o.setName('confirm').setDescription('Set true to confirm — wipes all balances, holdings & trades').setRequired(true))
    ),

  async execute(interaction) {
    const sub      = interaction.options.getSubcommand();
    const { guildId } = interaction;
    const config   = getConfig(guildId);
    const seasonNo = config.season_no ?? 1;

    // ── info (anyone) ─────────────────────────────────────────────────────────
    if (sub === 'info') {
      await interaction.deferReply();
      const prev  = stmt.getSeasonWinners.all(guildId, seasonNo - 1);
      const embed = brandEmbed({ title: `📅 Season ${seasonNo}`, color: GOLD, interaction })
        .setDescription(prev.length
          ? `**Season ${seasonNo - 1} podium:**\n` +
            prev.slice(0, 5).map((w, i) => `${['🥇','🥈','🥉'][i] ?? `#${w.rank}`} <@${w.user_id}> — ${cash(w.balance)}`).join('\n')
          : 'No previous season has ended yet. Climb `/serverleaderboard` to make the podium!');
      return interaction.editReply({ embeds: [embed] });
    }

    // ── reset (Manage Server only) ────────────────────────────────────────────
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('You need the **Manage Server** permission to reset the season.')], ephemeral: true });
    }
    if (!config.setup_by) {
      return interaction.reply({ embeds: [errorEmbed('Run `/setup` before starting seasons.')], ephemeral: true });
    }
    if (!interaction.options.getBoolean('confirm')) {
      return interaction.reply({ embeds: [errorEmbed('Set `confirm` to **true** to reset — this wipes all balances, holdings, and trades.')], ephemeral: true });
    }

    await interaction.deferReply();
    const result = resetSeason(guildId, config.starting_balance);
    const embed  = brandEmbed({ title: '🏁 Season Reset', color: GOLD, interaction })
      .setDescription(
        `Season **${result.endedSeason}** has ended — **${result.winners}** trader(s) recorded on the podium.\n` +
        `Everyone now starts **Season ${result.endedSeason + 1}** fresh with ${cash(config.starting_balance)}.`
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
