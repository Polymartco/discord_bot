import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { sign, colorOf, BLUE, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('cryptomarket')
    .setDescription('Crypto market overview'),

  async execute(interaction) {
    await interaction.deferReply();
    const m = await api.cryptoOverview();

    const embed = new EmbedBuilder()
      .setTitle('🪙 Crypto Market Overview')
      .setColor(BLUE)
      .addFields(
        { name: 'Total Market Cap', value: m.totalMarketCap ? `$${(m.totalMarketCap / 1e12).toFixed(3)}T` : '—', inline: true },
        { name: 'BTC Dominance',    value: m.btcDominance ? `${m.btcDominance.toFixed(2)}%` : '—',               inline: true },
        { name: 'Bullish',          value: String(m.bullishCount ?? '—'),                                         inline: true },
        { name: 'Bearish',          value: String(m.bearishCount ?? '—'),                                         inline: true },
        { name: 'Top Gainer',       value: m.topGainer ? `**${m.topGainer.symbol ?? m.topGainer.ticker}** ${sign(m.topGainer.changePct ?? m.topGainer.change ?? 0)}` : '—', inline: true },
        { name: 'Top Loser',        value: m.topLoser  ? `**${m.topLoser.symbol ?? m.topLoser.ticker}** ${sign(m.topLoser.changePct ?? m.topLoser.change ?? 0)}`   : '—', inline: true },
      );

    await interaction.editReply({ embeds: [polish(embed, interaction)] });
  },
};
