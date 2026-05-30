import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { BLUE, sign } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search across stocks, forex, and crypto')
    .addStringOption(o => o.setName('query').setDescription('Search term or ticker').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const q = interaction.options.getString('query');

    const [stocks, forex, crypto] = await Promise.allSettled([
      api.search(q),
      api.forexSearch(q),
      api.cryptoSearch(q),
    ]);

    const fmtList = (results, type) => {
      const list = results.status === 'fulfilled' ? (Array.isArray(results.value) ? results.value : Object.values(results.value)) : [];
      return list.slice(0, 5).map(r =>
        `**${r.ticker ?? r.symbol ?? r.pair ?? '?'}** ${r.name ? `— ${r.name}` : ''} $${r.price?.toFixed(4) ?? '?'} ${r.change != null ? sign(r.change) : ''}`
      ).join('\n') || '—';
    };

    const embed = new EmbedBuilder()
      .setTitle(`Search: "${q}"`)
      .setColor(BLUE)
      .addFields(
        { name: '📈 Stocks', value: fmtList(stocks, 'stock'),   inline: false },
        { name: '💱 Forex',  value: fmtList(forex, 'forex'),    inline: false },
        { name: '🪙 Crypto', value: fmtList(crypto, 'crypto'),  inline: false },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
