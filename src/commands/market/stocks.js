import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, BLUE, errorEmbed, sectorHeatmapBuffer, polish } from '../../utils.js';
import { registerPageSource, startPaginator } from '../../paginator.js';

const PAGE_SIZE = 15;

const SECTOR_CHOICES = [
  'tech','ai','crypto','bio','green','finance','gaming','health','defence',
  'retail','media','auto','realty','travel','energy','logistics','agri','food',
  'space','meme',
].map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s }));

const SORTERS = {
  change: (a, b) => (b.change ?? 0) - (a.change ?? 0),
  price:  (a, b) => (b.price  ?? 0) - (a.price  ?? 0),
  volume: (a, b) => (b.volume ?? 0) - (a.volume ?? 0),
  rsi:    (a, b) => (b.rsi    ?? 0) - (a.rsi    ?? 0),
  alpha:  (a, b) => a.ticker.localeCompare(b.ticker),
};

// ── Restart-proof page source ─────────────────────────────────────────────────
// args = [sector|'-', sortKey]. Re-fetches (cache-backed) and re-slices per page.
registerPageSource('stocks', async (interaction, { args, page }) => {
  const sector = args[0] && args[0] !== '-' ? args[0] : null;
  const sortBy = args[1] ?? 'change';

  const data = await api.stocks(sector);
  const list = Object.entries(data)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([ticker, s]) => ({ ticker, ...s }))
    .sort(SORTERS[sortBy] ?? SORTERS.change);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p     = Math.min(Math.max(0, page), totalPages - 1);
  const start = p * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);

  const lines = slice.map((s, i) => {
    const num    = String(start + i + 1).padStart(3, ' ');
    const change = sign(s.change ?? 0);
    const price  = s.price != null ? `$${s.price.toFixed(2)}` : '$—';
    return `\`${num}\` **${s.ticker}** — ${price} ${change}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(sector ? `${sector.toUpperCase()} Sector` : 'All Stocks')
    .setColor(BLUE)
    .setDescription(lines.join('\n') || 'No stocks found.')
    .setFooter({ text: `Page ${p + 1}/${totalPages} • ${list.length} stocks • sorted by ${sortBy}` });

  // Sector heatmap for context (only on the unfiltered view).
  const files = [];
  if (!sector) {
    const buf = sectorHeatmapBuffer(data);
    if (buf) { embed.setImage('attachment://heatmap.png'); files.push(new AttachmentBuilder(buf, { name: 'heatmap.png' })); }
  }

  return { embeds: [polish(embed, interaction)], files, totalPages };
});

export default {
  data: new SlashCommandBuilder()
    .setName('stocks')
    .setDescription('Browse all stocks with pagination')
    .setDMPermission(false)
    .addStringOption(o =>
      o.setName('sector').setDescription('Filter by sector').addChoices(...SECTOR_CHOICES)
    )
    .addStringOption(o =>
      o.setName('sort').setDescription('Sort by (default: change)')
        .addChoices(
          { name: 'Change %',     value: 'change'  },
          { name: 'Price',        value: 'price'   },
          { name: 'Volume',       value: 'volume'  },
          { name: 'RSI',          value: 'rsi'     },
          { name: 'Alphabetical', value: 'alpha'   },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const sector = interaction.options.getString('sector') ?? '-';
    const sortBy = interaction.options.getString('sort') ?? 'change';

    try {
      await startPaginator(interaction, {
        key:        'stocks',
        sourceArgs: [sector, sortBy],
        owner:      interaction.user.id,
      });
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }
  },
};
