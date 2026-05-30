import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, getConfig, executeTrade, stmt } from '../../db.js';
import { botApi } from '../../botApi.js';
import { detectAssetType, getFreshPrice, getCachedEntry, pricePath, ApiError } from '../../api.js';
import { cash, colorOf, sign, errorEmbed } from '../../utils.js';
import {
  ValidationError,
  validateTickerFormat,
  validateShareAmount,
  parseSharesOrAll,
  assertSufficientHolding,
  assertValidPrice,
  assertCommandCooldown,
  slippageWarning,
} from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell shares of a stock, forex pair, or crypto coin')
    .addStringOption(o => o.setName('ticker').setDescription('Ticker/symbol/pair').setRequired(true))
    .addStringOption(o => o.setName('shares').setDescription('Number of shares/units, or "all"').setRequired(true))
    .addStringOption(o =>
      o.setName('type').setDescription('Asset type (auto-detected if omitted)')
        .addChoices(
          { name: 'Stock',  value: 'stock'  },
          { name: 'Crypto', value: 'crypto' },
          { name: 'Forex',  value: 'forex'  },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guildId, user } = interaction;
    const config = getConfig(guildId);

    // ── 0. Input validation ───────────────────────────────────────────────────
    let ticker, assetType;
    try {
      assertCommandCooldown(user.id, 'trade', 1500);
      ticker    = validateTickerFormat(interaction.options.getString('ticker'));
      assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── 1. Linked-user path — route sell to Polymart server ───────────────────
    const link = stmt.getLink.get(user.id);
    if (link) {
      // Resolve "all" by fetching the server position
      let quantity;
      const rawShares = interaction.options.getString('shares').trim().toLowerCase();
      if (rawShares === 'all') {
        try {
          const data = await botApi('GET', `/discord/portfolio/${user.id}`);
          const pos  = (data.positions ?? []).find(p =>
            (p.symbol ?? p.ticker ?? '').toUpperCase() === ticker
          );
          if (!pos || !(pos.shares ?? pos.quantity)) {
            return interaction.editReply({ embeds: [errorEmbed(`You don't hold any **${ticker}** on Polymart.`)] });
          }
          quantity = pos.shares ?? pos.quantity;
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id); // stale link — fall through
          } else {
            return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
          }
        }
      } else {
        quantity = parseFloat(rawShares);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return interaction.editReply({ embeds: [errorEmbed('Enter a positive number of shares or "all".')] });
        }
      }

      if (quantity != null) {
        let result;
        try {
          result = await botApi('POST', '/discord/order', {
            discordUserId: user.id,
            portfolioId:   link.portfolio_id,
            symbol:        ticker,
            assetType,
            side:          'sell',
            quantity,
          });
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id); // stale — fall through
          } else {
            return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
          }
        }

        if (result) {
          // Mirror to local trade log
          try {
            stmt.insertTrade.run(guildId, user.id, ticker, assetType, 'sell',
              result.quantity, result.executedPrice, result.total, 0);
          } catch {}

          const pnlStr = result.realizedPnl != null
            ? ` (P&L: ${cash(result.realizedPnl)})`
            : '';

          const embed = new EmbedBuilder()
            .setColor(colorOf(result.realizedPnl ?? 0))
            .setTitle('✅ Order Filled — SELL')
            .addFields(
              { name: 'Asset',        value: ticker,                                    inline: true },
              { name: 'Type',         value: assetType,                                 inline: true },
              { name: 'Shares Sold',  value: result.quantity.toLocaleString(),           inline: true },
              { name: 'Price',        value: cash(result.executedPrice),                 inline: true },
              { name: 'Proceeds',     value: cash(result.total),                         inline: true },
              { name: 'Cash Left',    value: cash(result.newCashBalance),                inline: true },
            )
            .setFooter({ text: `🔗 Executed via polymart.co${pnlStr} • ${new Date().toLocaleTimeString()}` });

          return interaction.editReply({ embeds: [embed] });
        }
      }
    }

    // ── 2. Verify holding BEFORE fetching price (local path fast-fail) ────────
    getOrCreateUser(guildId, user.id, config.starting_balance);
    const holding = stmt.getHolding.get(guildId, user.id, ticker);

    let shares;
    try {
      shares = parseSharesOrAll(interaction.options.getString('shares'), holding?.shares);
      // validateShareAmount only when not selling "all" (parseSharesOrAll already validates "all")
      if (shares !== holding?.shares) validateShareAmount(shares);
      assertSufficientHolding(holding, ticker, shares);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── 3. Cached price snapshot before the fresh fetch ───────────────────────
    const cachedEntry = getCachedEntry(pricePath(ticker, assetType));
    const cachedPrice = cachedEntry?.data?.price ?? null;

    // ── 4. Authoritative fresh price ─────────────────────────────────────────
    let price;
    try {
      price = await getFreshPrice(ticker, assetType);
    } catch (err) {
      if (err instanceof ApiError) {
        return interaction.editReply({ embeds: [errorEmbed(`Could not fetch a live price for **${ticker}**. Try again in a moment.`)] });
      }
      throw err;
    }

    // ── 5. Price quality check ────────────────────────────────────────────────
    try {
      assertValidPrice(price, ticker);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── 6. Re-check holding hasn't changed between validation and execution ───
    const holdingNow = stmt.getHolding.get(guildId, user.id, ticker);
    try {
      assertSufficientHolding(holdingNow, ticker, shares);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── 7. Atomic trade execution ─────────────────────────────────────────────
    const fee    = shares * price * config.trading_fee_pct;
    const result = executeTrade(guildId, user.id, ticker, assetType, 'sell', shares, price, fee);
    if (!result.ok) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

    // ── 8. Post-trade diagnostics ─────────────────────────────────────────────
    const slip      = slippageWarning(price, cachedPrice);
    const pnlPct    = holding.avg_cost > 0 ? ((price - holding.avg_cost) / holding.avg_cost) * 100 : 0;
    const positionClosed = result.newShares <= 0;

    const footer = [
      `Executed ${new Date().toLocaleTimeString()}`,
      slip,
      positionClosed ? 'Position closed' : null,
    ].filter(Boolean).join(' • ');

    const embed = new EmbedBuilder()
      .setColor(colorOf(result.pnl))
      .setTitle('✅ Order Filled — SELL')
      .addFields(
        { name: 'Asset',          value: ticker,                                    inline: true },
        { name: 'Type',           value: assetType,                                 inline: true },
        { name: 'Shares Sold',    value: shares.toLocaleString(),                   inline: true },
        { name: 'Price',          value: cash(price),                               inline: true },
        { name: 'Proceeds',       value: cash(shares * price),                      inline: true },
        { name: 'Fee',            value: cash(fee),                                 inline: true },
        { name: 'Realised P&L',   value: `${cash(result.pnl)} (${sign(pnlPct)})`,  inline: true },
        { name: 'New Balance',    value: cash(result.newBalance),                   inline: true },
        { name: 'Remaining',      value: result.newShares.toLocaleString(),         inline: true },
      )
      .setFooter({ text: footer });

    await interaction.editReply({ embeds: [embed] });
  },
};
