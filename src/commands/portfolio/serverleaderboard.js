import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt, getConfig } from '../../db.js';
import { api } from '../../api.js';
import { cash, sign, GOLD, errorEmbed, leaderboardCardAttachment, polish } from '../../utils.js';
import { assertGuildSetup, ValidationError } from '../../validate.js';

const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${String(i + 1).padStart(2)}\``;

export default {
  data: new SlashCommandBuilder()
    .setName('serverleaderboard')
    .setDescription('Richest traders in this server')
    .setDMPermission(false)
    .addStringOption(o =>
      o.setName('metric').setDescription('Rank by (default: cash)')
        .addChoices(
          { name: 'Cash balance', value: 'cash' },
          { name: 'Return % (ROI)', value: 'roi' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const { guildId } = interaction;
    const config = getConfig(guildId);
    const metric = interaction.options.getString('metric') ?? 'cash';

    try {
      assertGuildSetup(config);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    const ranked = metric === 'roi'
      ? await buildRoi(guildId, config.starting_balance)
      : buildCash(guildId);

    if (!ranked.length) return interaction.editReply({ content: 'No users registered yet.' });

    const tags  = await Promise.allSettled(ranked.map(r => interaction.client.users.fetch(r.user_id)));
    const named = ranked.map((r, i) => ({
      ...r,
      tag: tags[i].status === 'fulfilled' ? tags[i].value.username : `User ${i + 1}`,
    }));

    const lines = named.map((r, i) =>
      metric === 'roi'
        ? `${medal(i)} **${r.tag}** — ${sign(r.roi)} _(${cash(r.equity)})_`
        : `${medal(i)} **${r.tag}** — ${cash(r.balance)}`
    );

    const embed = new EmbedBuilder()
      .setTitle(metric === 'roi' ? '📈 Server Leaderboard — Return %' : '🏆 Server Leaderboard — Cash')
      .setColor(GOLD)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Season ${config.season_no ?? 1}` });

    // Rendered card (degrades to the text embed if canvas is unavailable).
    const card = leaderboardCardAttachment(
      named.map(r => ({
        name:     r.tag,
        value:    metric === 'roi' ? sign(r.roi) : cash(r.balance),
        barValue: metric === 'roi' ? r.roi : r.balance,
      })),
      { title: metric === 'roi' ? 'Top Traders — Return %' : 'Top Traders — Cash' },
    );
    if (card) embed.setImage('attachment://leaderboard.png');
    polish(embed, interaction);

    await interaction.editReply({ embeds: [embed], ...(card ? { files: [card] } : {}) });
  },
};

// ── Cash ranking (cheap DB query) ─────────────────────────────────────────────
function buildCash(guildId) {
  return stmt.serverLeaderboard.all(guildId);
}

// ── ROI ranking: live equity = cash + Σ shares·price ──────────────────────────
// Prices come from at most three batched, cache-backed map calls (same trick the
// alert poller uses) — not one request per holding.
async function buildRoi(guildId, startingBalance) {
  const users    = stmt.allGuildUsers.all(guildId);
  const holdings = stmt.allGuildHoldings.all(guildId);

  const need = { stock: false, crypto: false, forex: false };
  for (const h of holdings) need[h.asset_type] = true;

  const [stocks, coins, pairs] = await Promise.all([
    need.stock  ? api.stocks().catch(() => ({}))      : {},
    need.crypto ? api.cryptoCoins().catch(() => ({}))  : {},
    need.forex  ? api.forexPairs().catch(() => ({}))   : {},
  ]);

  const priceOf = h => {
    const src = h.asset_type === 'crypto' ? coins : h.asset_type === 'forex' ? pairs : stocks;
    const p = src?.[h.ticker]?.price;
    return Number.isFinite(p) && p > 0 ? p : h.avg_cost; // fall back to cost basis
  };

  const equityByUser = new Map(users.map(u => [u.user_id, u.balance]));
  for (const h of holdings) {
    equityByUser.set(h.user_id, (equityByUser.get(h.user_id) ?? 0) + h.shares * priceOf(h));
  }

  return users
    .map(u => {
      const equity = equityByUser.get(u.user_id) ?? u.balance;
      const roi    = startingBalance > 0 ? ((equity - startingBalance) / startingBalance) * 100 : 0;
      return { user_id: u.user_id, equity, roi };
    })
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 10);
}
