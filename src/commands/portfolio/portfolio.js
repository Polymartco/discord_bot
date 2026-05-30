import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { api } from '../../api.js';
import { cash, sign, priceFmt, BLUE, errorEmbed } from '../../utils.js';
import { assertGuildSetup, ValidationError } from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('portfolio')
    .setDescription('All open positions with live P&L'),

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

    getOrCreateUser(guildId, user.id, config.starting_balance);
    const holdings = stmt.getAllHoldings.all(guildId, user.id);

    if (!holdings.length) {
      return interaction.editReply({ embeds: [errorEmbed('You have no open positions. Use `/buy` to start trading.')] });
    }

    const priceResults = await Promise.allSettled(
      holdings.map(h => {
        if (h.asset_type === 'forex')  return api.forexPair(h.ticker).then(p => p.price);
        if (h.asset_type === 'crypto') return api.cryptoCoin(h.ticker).then(c => c.price);
        return api.stock(h.ticker).then(s => s.price);
      })
    );

    let staleCount = 0;
    const fields = holdings.map((h, i) => {
      let price = h.avg_cost;
      let isStale = false;
      if (priceResults[i].status === 'fulfilled') {
        const p = priceResults[i].value;
        if (typeof p === 'number' && Number.isFinite(p) && p > 0) price = p;
        else { isStale = true; staleCount++; }
      } else {
        isStale = true; staleCount++;
      }

      const value  = h.shares * price;
      const cost   = h.shares * h.avg_cost;
      const pnl    = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      const staleTag = isStale ? ' ⚠️' : '';

      return {
        name:   `${h.ticker} (${h.asset_type})${staleTag}`,
        value:  `${h.shares.toLocaleString()} shares @ avg ${cash(h.avg_cost)}\nNow: ${priceFmt(price)} | Value: ${cash(value)}\nP&L: ${cash(pnl)} (${sign(pnlPct)})`,
        inline: false,
      };
    });

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Portfolio`)
      .setColor(BLUE)
      .addFields(fields);

    if (staleCount > 0) {
      embed.setFooter({ text: `⚠️ ${staleCount} position(s) showing cost basis — live price temporarily unavailable` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
