import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { BLUE, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('macro')
    .setDescription('Macroeconomic environment'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await api.macro();

    const embed = new EmbedBuilder()
      .setTitle('🏛️ Macro Environment')
      .setColor(BLUE)
      .addFields(
        { name: 'Interest Rate',   value: `${m.interestRate ?? '—'}%`,             inline: true },
        { name: 'Inflation',       value: `${m.inflation ?? '—'}%`,                inline: true },
        { name: 'GDP Growth',      value: `${m.gdpGrowth ?? '—'}%`,                inline: true },
        { name: 'Fear & Greed',    value: `${m.fearGreed ?? '—'} — ${m.fearGreedLabel ?? ''}`, inline: true },
        { name: 'VIX',             value: m.vix?.toFixed(2) ?? '—',                inline: true },
        { name: 'Advance/Decline', value: String(m.advanceDecline ?? '—'),         inline: true },
        { name: 'New Highs',       value: String(m.newHighs ?? '—'),               inline: true },
        { name: 'New Lows',        value: String(m.newLows ?? '—'),                inline: true },
        { name: 'Crash Cooldown',  value: String(m.crashCooldown ?? '—'),          inline: true },
        { name: 'Boom Cooldown',   value: String(m.boomCooldown ?? '—'),           inline: true },
      );

    await interaction.editReply({ embeds: [polish(embed, interaction)] });
  },
};
