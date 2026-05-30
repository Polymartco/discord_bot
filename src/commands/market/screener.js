import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, BLUE, errorEmbed } from '../../utils.js';

const SECTOR_CHOICES = [
  'tech','ai','crypto','bio','green','finance','gaming','health','defence',
  'retail','media','auto','realty','travel','energy','logistics','agri','food',
  'space','meme',
].map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s }));

export default {
  data: new SlashCommandBuilder()
    .setName('screener')
    .setDescription('Filter stocks by RSI, change %, and sector')
    .addStringOption(o =>
      o.setName('sector').setDescription('Filter by sector').addChoices(...SECTOR_CHOICES)
    )
    .addNumberOption(o =>
      o.setName('rsi_min').setDescription('Minimum RSI (0–100)').setMinValue(0).setMaxValue(100)
    )
    .addNumberOption(o =>
      o.setName('rsi_max').setDescription('Maximum RSI (0–100)').setMinValue(0).setMaxValue(100)
    )
    .addNumberOption(o =>
      o.setName('change_min').setDescription('Minimum change % (e.g. -5)')
    )
    .addNumberOption(o =>
      o.setName('change_max').setDescription('Maximum change % (e.g. 5)')
    )
    .addStringOption(o =>
      o.setName('sort').setDescription('Sort results by').addChoices(
        { name: 'Change %', value: 'change' },
        { name: 'RSI',      value: 'rsi'    },
        { name: 'Price',    value: 'price'  },
        { name: 'Volume',   value: 'volume' },
      )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sector    = interaction.options.getString('sector')     ?? null;
    const rsiMin    = interaction.options.getNumber('rsi_min')    ?? null;
    const rsiMax    = interaction.options.getNumber('rsi_max')    ?? null;
    const changeMin = interaction.options.getNumber('change_min') ?? null;
    const changeMax = interaction.options.getNumber('change_max') ?? null;
    const sortBy    = interaction.options.getString('sort')       ?? 'change';

    let data;
    try {
      data = await api.stocks(sector);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    let list = Object.entries(data)
      .filter(([, s]) => s && typeof s === 'object')
      .map(([ticker, s]) => ({ ticker, ...s }));

    // Apply filters
    if (rsiMin    !== null) list = list.filter(s => s.rsi    != null && s.rsi    >= rsiMin);
    if (rsiMax    !== null) list = list.filter(s => s.rsi    != null && s.rsi    <= rsiMax);
    if (changeMin !== null) list = list.filter(s => (s.change ?? 0) >= changeMin);
    if (changeMax !== null) list = list.filter(s => (s.change ?? 0) <= changeMax);

    const sorters = {
      change: (a, b) => (b.change ?? 0) - (a.change ?? 0),
      rsi:    (a, b) => (b.rsi    ?? 0) - (a.rsi    ?? 0),
      price:  (a, b) => (b.price  ?? 0) - (a.price  ?? 0),
      volume: (a, b) => (b.volume ?? 0) - (a.volume ?? 0),
    };
    list.sort(sorters[sortBy] ?? sorters.change);

    if (!list.length) {
      return interaction.editReply({ embeds: [errorEmbed('No stocks match your filters. Try widening the criteria.')] });
    }

    const shown = list.slice(0, 20);
    const lines = shown.map((s, i) => {
      const num    = String(i + 1).padStart(2, ' ');
      const price  = s.price != null ? `$${s.price.toFixed(2)}` : '$—';
      const change = sign(s.change ?? 0);
      const rsi    = s.rsi != null ? ` RSI:${s.rsi.toFixed(0)}` : '';
      return `\`${num}\` **${s.ticker}** — ${price} ${change}${rsi}`;
    });

    // Summarize applied filters for the footer
    const filters = [];
    if (sector)    filters.push(`sector: ${sector}`);
    if (rsiMin !== null) filters.push(`RSI ≥ ${rsiMin}`);
    if (rsiMax !== null) filters.push(`RSI ≤ ${rsiMax}`);
    if (changeMin !== null) filters.push(`change ≥ ${changeMin}%`);
    if (changeMax !== null) filters.push(`change ≤ ${changeMax}%`);

    const embed = new EmbedBuilder()
      .setTitle('🔍 Stock Screener')
      .setColor(BLUE)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: [
          `${list.length} match${list.length === 1 ? '' : 'es'}${list.length > 20 ? ` (top 20 shown)` : ''}`,
          filters.length ? `Filters: ${filters.join(' • ')}` : '',
        ].filter(Boolean).join(' • '),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
