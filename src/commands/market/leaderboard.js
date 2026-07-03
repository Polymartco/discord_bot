import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { BLUE, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Rank stocks by any metric')
    .addStringOption(o =>
      o.setName('by').setDescription('Metric to rank by')
        .addChoices(
          { name: 'Change',  value: 'change'  },
          { name: 'Price',   value: 'price'   },
          { name: 'Volume',  value: 'volume'  },
          { name: 'RSI',     value: 'rsi'     },
          { name: 'ATH',     value: 'ath'     },
          { name: 'Streak',  value: 'streak'  },
          { name: 'ATR',     value: 'atr'     },
          { name: 'Beta',    value: 'beta'    },
        )
    )
    .addStringOption(o =>
      o.setName('dir').setDescription('Sort direction')
        .addChoices({ name: 'Descending', value: 'desc' }, { name: 'Ascending', value: 'asc' })
    )
    .addIntegerOption(o => o.setName('limit').setDescription('Number of results (1–20)').setMinValue(1).setMaxValue(20)),

  async execute(interaction) {
    await interaction.deferReply();
    const by    = interaction.options.getString('by')    ?? 'change';
    const dir   = interaction.options.getString('dir')   ?? 'desc';
    const limit = interaction.options.getInteger('limit') ?? 10;

    const results = await api.leaderboard(by, dir, limit);
    const list    = Array.isArray(results) ? results : Object.values(results);

    const embed = new EmbedBuilder()
      .setTitle(`Stock Leaderboard — ${by} (${dir})`)
      .setColor(BLUE)
      .setDescription(
        list.map((s, i) =>
          `\`${String(i + 1).padStart(2)}\` **${s.ticker}** — ${by === 'change' ? `${s[by]?.toFixed(2) ?? '?'}%` : String(s[by] ?? '?')}`
        ).join('\n') || '—'
      );

    await interaction.editReply({ embeds: [polish(embed, interaction)] });
  },
};
