import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, getConfig, executeTrade, stmt } from '../../db.js';
import { botApi } from '../../botApi.js';
import { detectAssetType, getFreshPrice, getCachedEntry, pricePath, ApiError } from '../../api.js';
import { cash, colorOf, GREEN, errorEmbed } from '../../utils.js';
import {
  ValidationError,
  validateTickerFormat,
  validateShareAmount,
  assertGuildSetup,
  assertSufficientBalance,
  assertValidPrice,
  assertCommandCooldown,
  slippageWarning,
  concentrationWarning,
} from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy shares of a stock, forex pair, or crypto coin')
    .addStringOption(o => o.setName('ticker').setDescription('Ticker/symbol/pair').setRequired(true))
    .addNumberOption(o =>
      o.setName('shares').setDescription('Number of shares/units').setRequired(true).setMinValue(0.0001)
    )
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

    // ── 0. Input validation (always, regardless of link status) ───────────────
    let ticker, shares, assetType;
    try {
      assertCommandCooldown(user.id, 'trade', 1500);
      ticker    = validateTickerFormat(interaction.options.getString('ticker'));
      shares    = interaction.options.getNumber('shares');
      assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
      assertGuildSetup(config);
      validateShareAmount(shares);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── 1. Linked-user path — route order to Polymart server ─────────────────
    const link = stmt.getLink.get(user.id);
    if (link) {
      let result;
      try {
        result = await botApi('POST', '/discord/order', {
          discordUserId: user.id,
          portfolioId:   link.portfolio_id,
          symbol:        ticker,
          assetType,
          side:          'buy',
          quantity:      shares,
        });
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('No Polymart account')) {
          stmt.deleteLink.run(user.id); // stale link — fall through to local
        } else {
          return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
        }
      }

      if (result) {
        // Mirror to local trade log so /history still works
        try {
          stmt.insertTrade.run(guildId, user.id, ticker, assetType, 'buy',
            result.quantity, result.executedPrice, result.total, 0);
        } catch {}

        const embed = new EmbedBuilder()
          .setColor(GREEN)
          .setTitle('✅ Order Filled — BUY')
          .addFields(
            { name: 'Asset',       value: ticker,                                    inline: true },
            { name: 'Type',        value: assetType,                                 inline: true },
            { name: 'Shares',      value: result.quantity.toLocaleString(),           inline: true },
            { name: 'Price',       value: cash(result.executedPrice),                 inline: true },
            { name: 'Total Cost',  value: cash(result.total),                         inline: true },
            { name: 'Cash Left',   value: cash(result.newCashBalance),                inline: true },
          )
          .setFooter({ text: `🔗 Executed via polymart.co • ${new Date().toLocaleTimeString()}` });

        return interaction.editReply({ embeds: [embed] });
      }
    }

    // ── 2. Ensure user account exists (local path) ────────────────────────────
    const dbUser = getOrCreateUser(guildId, user.id, config.starting_balance);

    // ── 3. Read cached price BEFORE the fresh fetch (for slippage detection) ──
    const cachedEntry = getCachedEntry(pricePath(ticker, assetType));
    const cachedPrice = cachedEntry?.data?.price ?? null;

    // ── 4. Authoritative fresh price (bypasses cache) ─────────────────────────
    let price;
    try {
      price = await getFreshPrice(ticker, assetType);
    } catch (err) {
      if (err instanceof ApiError) {
        return interaction.editReply({ embeds: [errorEmbed(`**${ticker}** not found as a ${assetType}. Verify the ticker and asset type.`)] });
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

    // ── 6. Pre-flight balance check ───────────────────────────────────────────
    const fee       = shares * price * config.trading_fee_pct;
    const totalCost = shares * price + fee;
    try {
      assertSufficientBalance(dbUser.balance, totalCost);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // ── 7. Atomic trade execution ─────────────────────────────────────────────
    const result = executeTrade(guildId, user.id, ticker, assetType, 'buy', shares, price, fee);
    if (!result.ok) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

    // ── 8. Post-trade diagnostics ─────────────────────────────────────────────
    const slip        = slippageWarning(price, cachedPrice);
    const allHoldings = stmt.getAllHoldings.all(guildId, user.id);
    const portfolioInvested = allHoldings.reduce((s, h) => s + h.shares * h.avg_cost, 0);
    const positionCost = result.newShares * result.avgCost;
    const concentration = concentrationWarning(positionCost, result.newBalance + portfolioInvested);

    const warnings = [slip, concentration].filter(Boolean).join(' • ');

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ Order Filled — BUY')
      .addFields(
        { name: 'Asset',       value: ticker,                            inline: true },
        { name: 'Type',        value: assetType,                         inline: true },
        { name: 'Shares',      value: shares.toLocaleString(),           inline: true },
        { name: 'Price',       value: cash(price),                       inline: true },
        { name: 'Total Cost',  value: cash(shares * price),              inline: true },
        { name: 'Fee',         value: cash(fee),                         inline: true },
        { name: 'New Balance', value: cash(result.newBalance),           inline: true },
        { name: 'Avg Cost',    value: cash(result.avgCost),              inline: true },
        { name: 'Total Held',  value: result.newShares.toLocaleString(), inline: true },
      )
      .setFooter({ text: `Executed ${new Date().toLocaleTimeString()}${warnings ? ` • ${warnings}` : ''}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
