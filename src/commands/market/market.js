import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { sign, colorOf, BLUE } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('Global market snapshot'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await api.market();

    const indexChange = m.indexChangePct ?? m.indexChange ?? 0;

    const embed = new EmbedBuilder()
      .setTitle('📊 Market Overview')
      .setColor(colorOf(indexChange))
      .addFields(
        { name: 'Market Index',    value: `${m.index?.toFixed(2) ?? '—'} (${sign(indexChange)})`, inline: true },
        { name: 'Fear & Greed',    value: `${m.fearGreed ?? '—'} — ${m.fearGreedLabel ?? ''}`,    inline: true },
        { name: 'VIX',             value: m.vix?.toFixed(2) ?? '—',                               inline: true },
        { name: 'Interest Rate',   value: `${m.interestRate ?? '—'}%`,                            inline: true },
        { name: 'Inflation',       value: `${m.inflation ?? '—'}%`,                               inline: true },
        { name: 'Gainers',         value: String(m.gainers ?? '—'),                               inline: true },
        { name: 'Losers',          value: String(m.losers ?? '—'),                                inline: true },
        { name: 'Unchanged',       value: String(m.unchanged ?? '—'),                             inline: true },
        { name: 'Top Gainer',      value: m.topGainer ? `**${m.topGainer.ticker}** ${sign(m.topGainer.change)}` : '—', inline: true },
        { name: 'Top Loser',       value: m.topLoser  ? `**${m.topLoser.ticker}** ${sign(m.topLoser.change)}`   : '—', inline: true },
        { name: 'Up Streak',       value: String(m.upStreak ?? '—'),                              inline: true },
        { name: 'Down Streak',     value: String(m.downStreak ?? '—'),                            inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
