import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt, getConfig, getOrCreateUser } from '../../db.js';
import { api, detectAssetType } from '../../api.js';
import { BLUE, errorEmbed, successEmbed } from '../../utils.js';
import {
  ValidationError,
  validateTickerFormat,
  assertGuildSetup,
  assertAssetExists,
} from '../../validate.js';

const MAX_WATCHLIST = 20;

export default {
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage your watchlist')
    .addSubcommand(s => s.setName('view').setDescription('View your watchlist'))
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add an asset to your watchlist')
        .addStringOption(o => o.setName('ticker').setDescription('Ticker/symbol/pair').setRequired(true))
        .addStringOption(o =>
          o.setName('type').setDescription('Asset type (auto-detected if omitted)')
            .addChoices(
              { name: 'Stock',  value: 'stock'  },
              { name: 'Crypto', value: 'crypto' },
              { name: 'Forex',  value: 'forex'  },
            )
        )
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Remove an asset')
        .addStringOption(o => o.setName('ticker').setDescription('Ticker to remove').setRequired(true))
    ),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const { guildId, user } = interaction;
    const config  = getConfig(guildId);

    try {
      assertGuildSetup(config);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    getOrCreateUser(guildId, user.id, config.starting_balance);

    // ── view ──────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      const list = stmt.getWatchlist.all(guildId, user.id);
      if (!list.length) return interaction.reply({ embeds: [errorEmbed('Your watchlist is empty. Use `/watchlist add` to add assets.')], ephemeral: true });

      const prices = await Promise.allSettled(list.map(w => {
        if (w.asset_type === 'forex')  return api.forexPair(w.ticker);
        if (w.asset_type === 'crypto') return api.cryptoCoin(w.ticker);
        return api.stock(w.ticker);
      }));

      const lines = list.map((w, i) => {
        if (prices[i].status !== 'fulfilled') {
          return `**${w.ticker}** \`${w.asset_type}\` — ⚠️ price unavailable`;
        }
        const d      = prices[i].value;
        const change = d?.change ?? d?.changePct ?? 0;
        const price  = d?.price ?? 0;
        const dir    = change >= 0 ? '▲' : '▼';
        return `**${w.ticker}** \`${w.asset_type}\` — $${price.toFixed(4)} ${dir}${Math.abs(change).toFixed(2)}%`;
      });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle(`${user.username}'s Watchlist`)
          .setColor(BLUE)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `${list.length}/${MAX_WATCHLIST} slots used` })],
        ephemeral: true,
      });
    }

    // ── add ───────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      // Check watchlist size cap
      const current = stmt.getWatchlist.all(guildId, user.id);
      if (current.length >= MAX_WATCHLIST) {
        return interaction.reply({ embeds: [errorEmbed(`Watchlist full (${MAX_WATCHLIST} max). Remove something first.`)], ephemeral: true });
      }

      let ticker, assetType;
      try {
        ticker    = validateTickerFormat(interaction.options.getString('ticker'));
        assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
      } catch (err) {
        if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
        throw err;
      }

      // Verify asset actually exists before adding
      await interaction.deferReply({ ephemeral: true });
      try {
        await assertAssetExists(ticker, assetType);
      } catch (err) {
        if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
        throw err;
      }

      // Check for duplicate
      const alreadyWatching = current.some(w => w.ticker === ticker);
      if (alreadyWatching) {
        return interaction.editReply({ embeds: [errorEmbed(`**${ticker}** is already in your watchlist.`)] });
      }

      stmt.addWatch.run(guildId, user.id, ticker, assetType);
      return interaction.editReply({ embeds: [successEmbed(`Added **${ticker}** (${assetType}) to your watchlist.`)] });
    }

    // ── remove ────────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      let ticker;
      try {
        ticker = validateTickerFormat(interaction.options.getString('ticker'));
      } catch (err) {
        if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
        throw err;
      }

      const result = stmt.removeWatch.run(guildId, user.id, ticker);
      if (result.changes === 0) {
        return interaction.reply({ embeds: [errorEmbed(`**${ticker}** is not in your watchlist.`)], ephemeral: true });
      }
      return interaction.reply({ embeds: [successEmbed(`Removed **${ticker}** from your watchlist.`)], ephemeral: true });
    }
  },
};
