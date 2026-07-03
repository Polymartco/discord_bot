import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { registerComponent, buildId } from './interactionRouter.js';
import { buildStockCard, tradeButtons } from './cards.js';
import { errorEmbed, cash, sign, colorOf, GREEN, polish } from './utils.js';
import { getOrCreateUser, getConfig, executeTrade, stmt } from './db.js';
import { getFreshPrice, ApiError } from './api.js';
import {
  ValidationError, validateTickerFormat, validateShareAmount,
  parseSharesOrAll, assertSufficientBalance, assertSufficientHolding, assertValidPrice,
} from './validate.js';
import { recordTrade, progressField } from './postTrade.js';

// ── view: refresh a read-only card ────────────────────────────────────────────
registerComponent('view', async (interaction, { action, args }) => {
  if (action === 'stock') {
    const [ticker, type = 'stock'] = args;
    try {
      return await interaction.update(await buildStockCard(interaction, ticker, type));
    } catch {
      return interaction.reply({ embeds: [errorEmbed(`Couldn't refresh **${ticker}** right now.`)], ephemeral: true }).catch(() => {});
    }
  }
});

// ── trade: Buy/Sell button → open a quantity modal ────────────────────────────
registerComponent('trade', async (interaction, { action, ownerId, args }) => {
  const [ticker, type = 'stock'] = args;
  const isBuy = action === 'buy';

  const modal = new ModalBuilder()
    .setCustomId(buildId('trademodal', action, ownerId, ticker, type))
    .setTitle(`${isBuy ? 'Buy' : 'Sell'} ${ticker}`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('shares')
        .setLabel(isBuy ? 'Shares to buy' : 'Shares to sell (or "all")')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(isBuy ? 'e.g. 10' : 'e.g. 10 or all'),
    ));

  await interaction.showModal(modal).catch(() => {});
});

// ── trademodal: execute a LOCAL trade from the modal ──────────────────────────
registerComponent('trademodal', async (interaction, { action, args }) => {
  const [ticker, type = 'stock'] = args;
  await interaction.deferReply({ ephemeral: true });
  try {
    const embed = await executeLocalTrade(interaction, action, ticker, type, interaction.fields.getTextInputValue('shares'));
    await interaction.editReply({ embeds: [embed], components: [tradeButtons(interaction.user.id, ticker, type, { includeRefresh: false })] });
  } catch (err) {
    if (err instanceof ValidationError || err instanceof ApiError) {
      return interaction.editReply({ embeds: [errorEmbed(err.message)] });
    }
    console.error('[trademodal] unexpected error:', err);
    await interaction.editReply({ embeds: [errorEmbed('Something went wrong placing that order.')] });
  }
});

// Condensed local trade path — reuses the same validated primitives as the slash
// commands. Linked (Polymart) users are routed to the slash command instead.
async function executeLocalTrade(interaction, side, rawTicker, type, rawShares) {
  const { guildId, user } = interaction;

  if (stmt.getLink.get(user.id)) {
    throw new ValidationError("You're linked to Polymart — use `/buy` or `/sell` for synced trades.");
  }

  const ticker = validateTickerFormat(rawTicker);
  const config = getConfig(guildId);
  const dbUser = getOrCreateUser(guildId, user.id, config.starting_balance);

  let shares;
  let avgCostBefore = 0;
  if (side === 'sell') {
    const holding = stmt.getHolding.get(guildId, user.id, ticker);
    avgCostBefore = holding?.avg_cost ?? 0;
    shares = parseSharesOrAll(rawShares, holding?.shares);
    if (shares !== holding?.shares) validateShareAmount(shares);
    assertSufficientHolding(holding, ticker, shares);
  } else {
    shares = parseFloat(String(rawShares).trim());
    if (!Number.isFinite(shares) || shares <= 0) throw new ValidationError('Enter a positive number of shares.');
    validateShareAmount(shares);
  }

  const price = await getFreshPrice(ticker, type);
  assertValidPrice(price, ticker);

  const fee = shares * price * config.trading_fee_pct;
  if (side === 'buy') assertSufficientBalance(dbUser.balance, shares * price + fee);

  const result = executeTrade(guildId, user.id, ticker, type, side, shares, price, fee);
  if (!result.ok) throw new ValidationError(result.error);

  const isBuy  = side === 'buy';
  const pnlPct = !isBuy && avgCostBefore > 0 ? ((price - avgCostBefore) / avgCostBefore) * 100 : 0;

  const embed = new EmbedBuilder()
    .setColor(isBuy ? GREEN : colorOf(result.pnl ?? 0))
    .setTitle(`✅ Order Filled — ${isBuy ? 'BUY' : 'SELL'}`)
    .addFields(
      { name: 'Asset',                     value: ticker,                  inline: true },
      { name: 'Type',                      value: type,                    inline: true },
      { name: isBuy ? 'Shares' : 'Sold',   value: shares.toLocaleString(), inline: true },
      { name: 'Price',                     value: cash(price),             inline: true },
      { name: isBuy ? 'Cost' : 'Proceeds', value: cash(shares * price),    inline: true },
      { name: 'New Balance',               value: cash(result.newBalance), inline: true },
    )
    .setFooter({ text: `Executed ${new Date().toLocaleTimeString()}` });

  if (!isBuy) embed.addFields({ name: 'Realised P&L', value: `${cash(result.pnl)} (${sign(pnlPct)})`, inline: true });

  const field = progressField(recordTrade({
    guildId, userId: user.id, side, total: shares * price, pnlPct, balance: result.newBalance,
  }));
  if (field) embed.addFields(field);

  return polish(embed, interaction);
}
