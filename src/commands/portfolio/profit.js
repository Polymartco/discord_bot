import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { botApi } from '../../botApi.js';
import { api } from '../../api.js';
import { cash, colorOf, GOLD, errorEmbed } from '../../utils.js';
import { assertGuildSetup, ValidationError } from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('profit')
    .setDescription('Summary P&L — unrealised, realised, total'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guildId, user } = interaction;
    const config = getConfig(guildId);

    try {
      assertGuildSetup(config);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── Linked-user path — server unrealised + local realised ────────────────
    const link = stmt.getLink.get(user.id);
    if (link) {
      try {
        const data      = await botApi('GET', `/discord/portfolio/${user.id}`);
        const positions = data.positions ?? [];

        // Unrealised from server positions
        const unrealised = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
        const portValue  = positions.reduce((s, p) => s + (p.value ?? 0), 0);
        const invested   = positions.reduce((s, p) => s + (p.shares ?? p.quantity ?? 0) * (p.avgCost ?? 0), 0);

        // Realised from local mirrored Discord trade log
        const allTrades  = stmt.getAllTradesOrdered.all(guildId, user.id);
        let realisedPnl  = 0, wins = 0, losses = 0;
        const runAvg = {}, runShares = {};
        for (const t of allTrades) {
          if (t.side === 'buy') {
            const old = runShares[t.ticker] ?? 0, avg = runAvg[t.ticker] ?? 0;
            const nw  = old + t.shares;
            runAvg[t.ticker]    = nw > 0 ? (old * avg + t.total) / nw : 0;
            runShares[t.ticker] = nw;
          } else if (t.side === 'sell') {
            const tradePnl = (t.price - (runAvg[t.ticker] ?? 0)) * t.shares;
            realisedPnl   += tradePnl;
            runShares[t.ticker] = Math.max(0, (runShares[t.ticker] ?? 0) - t.shares);
            if (tradePnl >= 0) wins++; else losses++;
          }
        }

        const totalPnl  = realisedPnl + unrealised;
        const totalSells = wins + losses;
        const winRate    = totalSells > 0 ? `${((wins / totalSells) * 100).toFixed(1)}%` : '—';

        const embed = new EmbedBuilder()
          .setTitle(`${user.username}'s P&L Summary`)
          .setColor(colorOf(totalPnl))
          .addFields(
            { name: 'Realised P&L',   value: cash(realisedPnl), inline: true },
            { name: 'Unrealised P&L', value: cash(unrealised),  inline: true },
            { name: 'Total P&L',      value: cash(totalPnl),    inline: true },
            { name: 'Win Rate',       value: winRate,            inline: true },
            { name: 'Closed Trades',  value: String(totalSells), inline: true },
          )
          .setFooter({ text: '🔗 Unrealised from polymart.co • Realised from Discord trades only' });

        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('No Polymart account')) {
          stmt.deleteLink.run(user.id); // stale — fall through
        } else {
          return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
        }
      }
    }

    // ── Local SQLite path ─────────────────────────────────────────────────────
    getOrCreateUser(guildId, user.id, config.starting_balance);

    // ── Realised P&L via running-average FIFO ─────────────────────────────────
    // Process trades chronologically to compute the avg cost basis at the time of
    // each sell. This prevents open positions from distorting the realised number.
    const allTrades = stmt.getAllTradesOrdered.all(guildId, user.id);

    let realisedPnl = 0;
    let totalFees   = 0;
    let wins = 0, losses = 0;
    const runningAvg    = {}; // ticker → weighted avg cost at this point in history
    const runningShares = {}; // ticker → shares held per trade history

    for (const t of allTrades) {
      totalFees += t.fee;

      if (t.side === 'buy') {
        const oldShares = runningShares[t.ticker] ?? 0;
        const oldAvg    = runningAvg[t.ticker]    ?? 0;
        const newShares = oldShares + t.shares;
        runningAvg[t.ticker]    = newShares > 0 ? (oldShares * oldAvg + t.total) / newShares : 0;
        runningShares[t.ticker] = newShares;
      } else if (t.side === 'sell') {
        const avgCost  = runningAvg[t.ticker] ?? 0;
        const tradePnl = (t.price - avgCost) * t.shares;
        realisedPnl   += tradePnl;
        runningShares[t.ticker] = Math.max(0, (runningShares[t.ticker] ?? 0) - t.shares);
        if (tradePnl >= 0) wins++; else losses++;
      }
    }

    // ── Unrealised P&L — live prices for open holdings ────────────────────────
    const holdings = stmt.getAllHoldings.all(guildId, user.id);
    let portfolioValue = 0;
    let staleCount     = 0;

    const priceResults = await Promise.allSettled(
      holdings.map(h => {
        if (h.asset_type === 'forex')  return api.forexPair(h.ticker).then(p => p.price);
        if (h.asset_type === 'crypto') return api.cryptoCoin(h.ticker).then(c => c.price);
        return api.stock(h.ticker).then(s => s.price);
      })
    );

    holdings.forEach((h, i) => {
      if (priceResults[i].status === 'fulfilled') {
        const p = priceResults[i].value;
        if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
          portfolioValue += h.shares * p;
          return;
        }
      }
      portfolioValue += h.shares * h.avg_cost;
      staleCount++;
    });

    const invested   = holdings.reduce((sum, h) => sum + h.shares * h.avg_cost, 0);
    const unrealised = portfolioValue - invested;
    const totalPnl   = realisedPnl + unrealised;

    const totalSells = wins + losses;
    const winRate    = totalSells > 0 ? `${((wins / totalSells) * 100).toFixed(1)}%` : '—';

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s P&L Summary`)
      .setColor(colorOf(totalPnl))
      .addFields(
        { name: 'Realised P&L',   value: cash(realisedPnl),   inline: true },
        { name: 'Unrealised P&L', value: cash(unrealised),    inline: true },
        { name: 'Total P&L',      value: cash(totalPnl),      inline: true },
        { name: 'Total Fees',     value: cash(totalFees),      inline: true },
        { name: 'Win Rate',       value: winRate,              inline: true },
        { name: 'Closed Trades',  value: String(totalSells),   inline: true },
      );

    if (staleCount > 0) {
      embed.setFooter({ text: `⚠️ ${staleCount} position(s) using cost basis — live price unavailable` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
