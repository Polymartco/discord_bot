import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, BLUE, errorEmbed, marketOverviewAttachment } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('overview')
    .setDescription('Multi-line chart of the top stocks by volume on a single normalized graph'),

  async execute(interaction) {
    await interaction.deferReply();

    let stocks;
    try {
      stocks = await api.stocks();
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    const list = Object.entries(stocks).filter(([, s]) => s && typeof s === 'object');

    // Sort for embed fields
    const byChange = [...list].sort((a, b) => (b[1].change ?? 0) - (a[1].change ?? 0));
    const gainers  = list.filter(([, s]) => (s.change ?? 0) > 0).length;
    const losers   = list.filter(([, s]) => (s.change ?? 0) < 0).length;
    const topGainer = byChange[0];
    const topLoser  = byChange[byChange.length - 1];

    const att = marketOverviewAttachment(stocks);

    const embed = new EmbedBuilder()
      .setTitle('📊 Market Overview')
      .setColor(BLUE)
      .addFields(
        { name: 'Gainers',    value: String(gainers),  inline: true },
        { name: 'Losers',     value: String(losers),   inline: true },
        { name: 'Total',      value: String(list.length), inline: true },
        {
          name:   'Top Gainer',
          value:  topGainer ? `**${topGainer[0]}** ${sign(topGainer[1].change ?? 0)} @ $${(topGainer[1].price ?? 0).toFixed(2)}` : '—',
          inline: true,
        },
        {
          name:   'Top Loser',
          value:  topLoser ? `**${topLoser[0]}** ${sign(topLoser[1].change ?? 0)} @ $${(topLoser[1].price ?? 0).toFixed(2)}` : '—',
          inline: true,
        },
      )
      .setFooter({ text: 'Chart shows top 8 stocks by volume, each normalized to its own price range' });

    if (att) embed.setImage('attachment://overview.png');

    await interaction.editReply({ embeds: [embed], ...(att ? { files: [att] } : {}) });
  },
};
