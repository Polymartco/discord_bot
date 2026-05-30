import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, BLUE, errorEmbed } from '../../utils.js';

const PAGE_SIZE = 15;

const SECTOR_CHOICES = [
  'tech','ai','crypto','bio','green','finance','gaming','health','defence',
  'retail','media','auto','realty','travel','energy','logistics','agri','food',
  'space','meme',
].map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s }));

export default {
  data: new SlashCommandBuilder()
    .setName('stocks')
    .setDescription('Browse all stocks with pagination')
    .addStringOption(o =>
      o.setName('sector').setDescription('Filter by sector').addChoices(...SECTOR_CHOICES)
    )
    .addStringOption(o =>
      o.setName('sort').setDescription('Sort by (default: change)')
        .addChoices(
          { name: 'Change %',  value: 'change'  },
          { name: 'Price',     value: 'price'   },
          { name: 'Volume',    value: 'volume'  },
          { name: 'RSI',       value: 'rsi'     },
          { name: 'Alphabetical', value: 'alpha' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const sector = interaction.options.getString('sector') ?? null;
    const sortBy = interaction.options.getString('sort') ?? 'change';

    let data;
    try {
      data = await api.stocks(sector);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // getStocks returns { "APEX": { price, change, ... } } — ticker is the map key
    const list = Object.entries(data)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([ticker, s]) => ({ ticker, ...s }));

    if (!list.length) return interaction.editReply({ content: 'No stocks found.' });

    const sorters = {
      change: (a, b) => (b.change ?? 0)  - (a.change ?? 0),
      price:  (a, b) => (b.price  ?? 0)  - (a.price  ?? 0),
      volume: (a, b) => (b.volume ?? 0)  - (a.volume ?? 0),
      rsi:    (a, b) => (b.rsi    ?? 0)  - (a.rsi    ?? 0),
      alpha:  (a, b) => a.ticker.localeCompare(b.ticker),
    };
    list.sort(sorters[sortBy] ?? sorters.change);

    const totalPages = Math.ceil(list.length / PAGE_SIZE);
    let page = 0;

    const buildEmbed = (p) => {
      const start = p * PAGE_SIZE;
      const slice = list.slice(start, start + PAGE_SIZE);

      const lines = slice.map((s, i) => {
        const num    = String(start + i + 1).padStart(3, ' ');
        const change = sign(s.change ?? 0);
        const price  = s.price != null ? `$${s.price.toFixed(2)}` : '$—';
        return `\`${num}\` **${s.ticker}** — ${price} ${change}`;
      });

      return new EmbedBuilder()
        .setTitle(sector ? `${sector.toUpperCase()} Sector Stocks` : 'All Stocks')
        .setColor(BLUE)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Page ${p + 1}/${totalPages} • ${list.length} stocks • sorted by ${sortBy}` });
    };

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stocks_prev')
        .setLabel('◀  Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p === 0),
      new ButtonBuilder()
        .setCustomId('stocks_page')
        .setLabel(`${p + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('stocks_next')
        .setLabel('Next  ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p >= totalPages - 1),
    );

    const msg = await interaction.editReply({
      embeds:     [buildEmbed(page)],
      components: [buildRow(page)],
    });

    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time:   120_000, // 2 minutes
    });

    collector.on('collect', async i => {
      if (i.customId === 'stocks_next') page = Math.min(page + 1, totalPages - 1);
      if (i.customId === 'stocks_prev') page = Math.max(page - 1, 0);
      await i.update({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
    });

    collector.on('end', () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('stocks_prev').setLabel('◀  Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('stocks_page').setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('stocks_next').setLabel('Next  ▶').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  },
};
