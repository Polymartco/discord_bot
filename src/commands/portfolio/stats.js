import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { botApi } from '../../botApi.js';
import { cash, colorOf, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Full trading performance summary across all portfolios'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guildId, user } = interaction;

    // ── Linked path — server performance summary ──────────────────────────────
    const link = stmt.getLink.get(user.id);
    if (link) {
      try {
        const s = await botApi('GET', `/discord/stats/${user.id}`);

        const winRate  = s.winRate  != null ? `${(Number(s.winRate) * 100).toFixed(1)}%` : '—';
        const bestStr  = s.bestTrade  != null ? cash(s.bestTrade)  : '—';
        const worstStr = s.worstTrade != null ? cash(s.worstTrade) : '—';

        const embed = new EmbedBuilder()
          .setTitle(`${user.username}'s Trading Stats`)
          .setColor(colorOf(s.totalRealisedPnl ?? 0))
          .addFields(
            { name: 'Cash Balance',     value: cash(s.totalCash ?? 0),         inline: true },
            { name: 'Portfolios',       value: String(s.numPortfolios ?? '—'),  inline: true },
            { name: 'Total Orders',     value: String(s.totalOrders ?? '—'),    inline: true },
            { name: 'Closed Positions', value: String(s.closedPositions ?? '—'), inline: true },
            { name: 'Win Rate',         value: winRate,                          inline: true },
            { name: 'Realised P&L',     value: cash(s.totalRealisedPnl ?? 0),  inline: true },
            { name: 'Best Trade',       value: bestStr,                          inline: true },
            { name: 'Worst Trade',      value: worstStr,                         inline: true },
          )
          .setFooter({ text: '🔗 Synced from polymart.co' });

        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('No Polymart account')) {
          stmt.deleteLink.run(user.id);
        } else {
          return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
        }
      }
    }

    // ── Local SQLite path — derive stats from trade history ───────────────────
    const config = getConfig(guildId);
    const dbUser = getOrCreateUser(guildId, user.id, config.starting_balance);
    const trades = stmt.getAllTradesOrdered.all(guildId, user.id);

    let realisedPnl = 0, wins = 0, losses = 0;
    let bestTrade = null, worstTrade = null;
    const runAvg = {}, runShares = {};

    for (const t of trades) {
      if (t.side === 'buy') {
        const old = runShares[t.ticker] ?? 0;
        const avg = runAvg[t.ticker]    ?? 0;
        const nw  = old + t.shares;
        runAvg[t.ticker]    = nw > 0 ? (old * avg + t.total) / nw : 0;
        runShares[t.ticker] = nw;
      } else if (t.side === 'sell') {
        const pnl = (t.price - (runAvg[t.ticker] ?? 0)) * t.shares;
        realisedPnl += pnl;
        runShares[t.ticker] = Math.max(0, (runShares[t.ticker] ?? 0) - t.shares);
        if (pnl >= 0) wins++; else losses++;
        if (bestTrade  === null || pnl > bestTrade)  bestTrade  = pnl;
        if (worstTrade === null || pnl < worstTrade) worstTrade = pnl;
      }
    }

    const totalSells = wins + losses;
    const winRateStr = totalSells > 0 ? `${((wins / totalSells) * 100).toFixed(1)}%` : '—';

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Trading Stats`)
      .setColor(colorOf(realisedPnl))
      .addFields(
        { name: 'Cash Balance',     value: cash(dbUser.balance),                           inline: true },
        { name: 'Portfolios',       value: '1',                                             inline: true },
        { name: 'Total Orders',     value: String(trades.length),                           inline: true },
        { name: 'Closed Positions', value: String(totalSells),                              inline: true },
        { name: 'Win Rate',         value: winRateStr,                                      inline: true },
        { name: 'Realised P&L',     value: cash(realisedPnl),                              inline: true },
        { name: 'Best Trade',       value: bestTrade  != null ? cash(bestTrade)  : '—',    inline: true },
        { name: 'Worst Trade',      value: worstTrade != null ? cash(worstTrade) : '—',    inline: true },
      )
      .setFooter({ text: 'Local portfolio · Link your Polymart account for full stats' });

    await interaction.editReply({ embeds: [embed] });
  },
};
