import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt, getConfig, getOrCreateUser } from '../../db.js';
import { botApi } from '../../botApi.js';
import { api, detectAssetType } from '../../api.js';
import { BLUE, errorEmbed, successEmbed } from '../../utils.js';
import { ValidationError, validateTickerFormat, assertAssetExists } from '../../validate.js';
import { respondTickerAutocomplete } from '../../autocomplete.js';

const MAX_WATCHLIST = 20;

export default {
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage your watchlist')
    .setDMPermission(false)
    .addSubcommand(s => s.setName('view').setDescription('View your watchlist'))
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add an asset to your watchlist')
        .addStringOption(o => o.setName('ticker').setDescription('Ticker/symbol/pair').setRequired(true).setAutocomplete(true))
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
        .addStringOption(o => o.setName('ticker').setDescription('Ticker to remove').setRequired(true).setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    // remove → suggest items already on the watchlist; add → search all assets.
    if (interaction.options.getSubcommand() === 'remove') {
      const focused = String(interaction.options.getFocused() ?? '').trim().toUpperCase();
      try {
        const list = stmt.getWatchlist.all(interaction.guildId, interaction.user.id);
        return interaction.respond(list
          .filter(w => !focused || w.ticker.includes(focused))
          .slice(0, 25)
          .map(w => ({ name: `${w.ticker} (${w.asset_type})`.slice(0, 100), value: w.ticker })));
      } catch { return interaction.respond([]); }
    }
    return respondTickerAutocomplete(interaction, interaction.options.getString('type') ?? 'stock');
  },

  async execute(interaction) {
    const sub  = interaction.options.getSubcommand();
    const { guildId, user } = interaction;
    const link = stmt.getLink.get(user.id);

    // ══ LINKED PATH ═══════════════════════════════════════════════════════════

    if (link) {
      if (sub === 'view') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const data  = await botApi('GET', `/discord/watchlist/${user.id}`);
          const items = data.watchlist ?? data.items ?? (Array.isArray(data) ? data : []);

          if (!items.length) {
            return interaction.editReply({ embeds: [errorEmbed('Your watchlist is empty. Use `/watchlist add` to add assets.')] });
          }

          const lines = items.map(w => {
            const sym    = w.symbol ?? w.ticker ?? '?';
            const type   = w.assetType ?? w.asset_type ?? 'stock';
            const price  = w.price  != null ? `$${Number(w.price).toFixed(4)}` : '—';
            const change = w.change != null ? Number(w.change) : null;
            const dir    = change != null ? (change >= 0 ? '▲' : '▼') : '';
            const pct    = change != null ? `${dir}${Math.abs(change).toFixed(2)}%` : '';
            return `**${sym}** \`${type}\` — ${price} ${pct}`.trimEnd();
          });

          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setTitle(`${user.username}'s Watchlist`)
              .setColor(BLUE)
              .setDescription(lines.join('\n'))
              .setFooter({ text: `${items.length} items · 🔗 polymart.co` })],
          });
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id); // stale — fall through to local
          } else {
            return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
          }
        }
      }

      if (sub === 'add') {
        let ticker, assetType;
        try {
          ticker    = validateTickerFormat(interaction.options.getString('ticker'));
          assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
        } catch (err) {
          if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          throw err;
        }

        await interaction.deferReply({ ephemeral: true });

        try { await assertAssetExists(ticker, assetType); }
        catch (err) {
          if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
          throw err;
        }

        try {
          await botApi('POST', `/discord/watchlist/${user.id}`, { symbol: ticker, assetType });
          return interaction.editReply({ embeds: [successEmbed(`Added **${ticker}** (${assetType}) to your watchlist.`)] });
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id);
          } else if (err.message.toLowerCase().includes('already')) {
            return interaction.editReply({ embeds: [errorEmbed(`**${ticker}** is already in your watchlist.`)] });
          } else {
            return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
          }
        }
      }

      if (sub === 'remove') {
        let ticker, assetType;
        try {
          ticker    = validateTickerFormat(interaction.options.getString('ticker'));
          assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
        } catch (err) {
          if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          throw err;
        }

        try {
          await botApi('DELETE', `/discord/watchlist/${user.id}`, { symbol: ticker, assetType });
          return interaction.reply({ embeds: [successEmbed(`Removed **${ticker}** from your watchlist.`)], ephemeral: true });
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id);
          } else {
            return interaction.reply({ embeds: [errorEmbed(`Polymart: ${err.message}`)], ephemeral: true });
          }
        }
      }
    }

    // ══ LOCAL PATH ════════════════════════════════════════════════════════════

    const config = getConfig(guildId);
    getOrCreateUser(guildId, user.id, config.starting_balance);

    if (sub === 'view') {
      const list = stmt.getWatchlist.all(guildId, user.id);
      if (!list.length) {
        return interaction.reply({ embeds: [errorEmbed('Your watchlist is empty. Use `/watchlist add` to add assets.')], ephemeral: true });
      }

      const prices = await Promise.allSettled(list.map(w => {
        if (w.asset_type === 'forex')  return api.forexPair(w.ticker);
        if (w.asset_type === 'crypto') return api.cryptoCoin(w.ticker);
        return api.stock(w.ticker);
      }));

      const lines = list.map((w, i) => {
        if (prices[i].status !== 'fulfilled') return `**${w.ticker}** \`${w.asset_type}\` — ⚠️ price unavailable`;
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

    if (sub === 'add') {
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

      if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

      try { await assertAssetExists(ticker, assetType); }
      catch (err) {
        if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
        throw err;
      }

      if (current.some(w => w.ticker === ticker)) {
        return interaction.editReply({ embeds: [errorEmbed(`**${ticker}** is already in your watchlist.`)] });
      }

      stmt.addWatch.run(guildId, user.id, ticker, assetType);
      return interaction.editReply({ embeds: [successEmbed(`Added **${ticker}** (${assetType}) to your watchlist.`)] });
    }

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
