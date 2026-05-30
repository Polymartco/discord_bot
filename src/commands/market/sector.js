import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, colorOf, errorEmbed } from '../../utils.js';

const SECTORS = ['tech','ai','crypto','bio','green','finance','gaming','health','defence',
  'retail','media','auto','realty','travel','energy','logistics','agri','food','space','meme'];

export default {
  data: new SlashCommandBuilder()
    .setName('sector')
    .setDescription('Sector breakdown with top stocks')
    .addStringOption(o =>
      o.setName('key').setDescription('Sector to view').setRequired(true)
        .addChoices(...SECTORS.map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s })))
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const key = interaction.options.getString('key');

    let s;
    try {
      s = await api.sector(key);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // sector.stocks may be an array or a ticker-keyed map — handle both
    const rawStocks = s.stocks ?? s.topStocks ?? [];
    const stockList = Array.isArray(rawStocks)
      ? rawStocks
      : Object.entries(rawStocks).map(([ticker, data]) => ({ ticker, ...data }));

    const topStocks = stockList
      .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
      .slice(0, 5);

    const embed = new EmbedBuilder()
      .setTitle(`${key.toUpperCase()} Sector`)
      .setColor(colorOf(s.avgChange ?? 0))
      .addFields(
        { name: 'Avg Change', value: sign(s.avgChange ?? 0), inline: true },
        { name: 'Momentum',   value: String(s.momentum ?? '—'), inline: true },
        { name: 'News',       value: (s.newsStack ?? []).slice(0, 2).join('\n') || '—', inline: false },
      );

    if (topStocks.length) {
      embed.addFields({
        name: 'Top Stocks',
        value: topStocks.map((t, i) =>
          `\`${i + 1}\` **${t.ticker ?? '?'}** — $${t.price?.toFixed(2) ?? '?'} ${sign(t.change ?? 0)}`
        ).join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
