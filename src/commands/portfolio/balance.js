import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { api, ApiError } from '../../api.js';
import { cash, colorOf, GOLD, errorEmbed } from '../../utils.js';
import { assertGuildSetup, ValidationError } from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show your balance and portfolio value'),

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

    const dbUser   = getOrCreateUser(guildId, user.id, config.starting_balance);
    const holdings = stmt.getAllHoldings.all(guildId, user.id);

    // Fetch live prices in parallel; fall back to avg_cost if any individual call fails
    const priceResults = await Promise.allSettled(
      holdings.map(h => {
        if (h.asset_type === 'forex')  return api.forexPair(h.ticker).then(p => p.price);
        if (h.asset_type === 'crypto') return api.cryptoCoin(h.ticker).then(c => c.price);
        return api.stock(h.ticker).then(s => s.price);
      })
    );

    let portfolioValue = 0;
    let staleCount     = 0;
    holdings.forEach((h, i) => {
      if (priceResults[i].status === 'fulfilled') {
        const p = priceResults[i].value;
        if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
          portfolioValue += h.shares * p;
          return;
        }
      }
      // Fallback to cost basis — flag for user
      portfolioValue += h.shares * h.avg_cost;
      staleCount++;
    });

    const totalValue = dbUser.balance + portfolioValue;
    const invested   = holdings.reduce((s, h) => s + h.shares * h.avg_cost, 0);
    const unrealised = portfolioValue - invested;

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Account`)
      .setColor(colorOf(unrealised))
      .addFields(
        { name: 'Cash Balance',    value: cash(dbUser.balance),    inline: true },
        { name: 'Portfolio Value', value: cash(portfolioValue),    inline: true },
        { name: 'Total Value',     value: cash(totalValue),        inline: true },
        { name: 'Invested',        value: cash(invested),          inline: true },
        { name: 'Unrealised P&L',  value: cash(unrealised),        inline: true },
        { name: 'Holdings',        value: String(holdings.length), inline: true },
      );

    if (staleCount > 0) {
      embed.setFooter({ text: `⚠️ ${staleCount} holding(s) using cost basis — live price unavailable` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
