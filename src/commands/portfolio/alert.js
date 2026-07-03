import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt, getConfig, getOrCreateUser } from '../../db.js';
import { botApi } from '../../botApi.js';
import { detectAssetType, getFreshPrice, ApiError } from '../../api.js';
import { GOLD, errorEmbed, successEmbed, cash, polish } from '../../utils.js';
import { ValidationError, validateTickerFormat, assertValidPrice } from '../../validate.js';
import { respondTickerAutocomplete } from '../../autocomplete.js';

const MAX_ALERTS_LOCAL  = 5;
const MAX_ALERTS_LINKED = 10;

export default {
  data: new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Set, list, or clear price alerts')
    .setDMPermission(false)
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Set a price alert')
        .addStringOption(o => o.setName('ticker').setDescription('Ticker/symbol/pair').setRequired(true).setAutocomplete(true))
        .addStringOption(o =>
          o.setName('direction').setDescription('Alert when price goes above or below').setRequired(true)
            .addChoices({ name: 'Above', value: 'above' }, { name: 'Below', value: 'below' })
        )
        .addNumberOption(o => o.setName('price').setDescription('Target price').setRequired(true).setMinValue(0))
        .addStringOption(o =>
          o.setName('type').setDescription('Asset type (auto-detected if omitted)')
            .addChoices(
              { name: 'Stock',  value: 'stock'  },
              { name: 'Crypto', value: 'crypto' },
              { name: 'Forex',  value: 'forex'  },
            )
        )
        .addStringOption(o =>
          o.setName('note').setDescription('Optional reminder note shown when the alert fires')
        )
    )
    .addSubcommand(s => s.setName('list').setDescription('List your active alerts'))
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription('Clear an alert by ID')
        .addStringOption(o => o.setName('id').setDescription('Alert ID (from /alert list)').setRequired(true).setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    // clear → suggest the user's own local alert IDs; set → ticker search.
    if (interaction.options.getSubcommand() === 'clear') {
      try {
        const alerts = stmt.getAlerts.all(interaction.guildId, interaction.user.id);
        return interaction.respond(alerts.slice(0, 25).map(a => ({
          name:  `#${a.id} ${a.ticker} ${a.direction} ${a.threshold}`.slice(0, 100),
          value: String(a.id),
        })));
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
      if (sub === 'list') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const data   = await botApi('GET', `/discord/alerts/${user.id}`);
          const alerts = data.alerts ?? (Array.isArray(data) ? data : []);

          if (!alerts.length) {
            return interaction.editReply({ embeds: [errorEmbed('No active alerts. Use `/alert set` to create one.')] });
          }

          const lines = alerts.map(a => {
            const sym  = a.symbol ?? a.ticker ?? '?';
            const type = a.assetType ?? a.asset_type ?? 'stock';
            const note = a.note ? ` — _${a.note}_` : '';
            return `\`ID ${a.id}\` **${sym}** (${type}) — ${a.direction} ${cash(a.threshold)}${note}`;
          });

          return interaction.editReply({
            embeds: [polish(new EmbedBuilder()
              .setTitle('Your Price Alerts')
              .setColor(GOLD)
              .setDescription(lines.join('\n'))
              .setFooter({ text: `${alerts.length}/${MAX_ALERTS_LINKED} slots · 🔗 polymart.co · Fires as DM` }), interaction)],
          });
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id);
          } else {
            return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
          }
        }
      }

      if (sub === 'set') {
        let ticker, assetType;
        try {
          ticker    = validateTickerFormat(interaction.options.getString('ticker'));
          assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
        } catch (err) {
          if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          throw err;
        }

        const direction = interaction.options.getString('direction');
        const threshold = interaction.options.getNumber('price');
        const note      = interaction.options.getString('note') ?? null;

        await interaction.deferReply({ ephemeral: true });

        let currentPrice;
        try {
          currentPrice = await getFreshPrice(ticker, assetType);
          assertValidPrice(currentPrice, ticker);
        } catch (err) {
          if (err instanceof ApiError || err instanceof ValidationError) {
            return interaction.editReply({ embeds: [errorEmbed(`Could not verify **${ticker}** — check the ticker and type.`)] });
          }
          throw err;
        }

        try {
          await botApi('POST', `/discord/alerts/${user.id}`, { symbol: ticker, assetType, direction, threshold, note });

          const crossed =
            (direction === 'above' && currentPrice >= threshold) ||
            (direction === 'below' && currentPrice <= threshold);

          const lines = [
            `Alert set: **${ticker}** ${direction} ${cash(threshold)}`,
            `Current price: ${cash(currentPrice)}`,
            crossed ? `⚠️ Threshold already ${direction === 'above' ? 'exceeded' : 'undercut'} — fires next tick.` : null,
            note ? `Note: _${note}_` : null,
          ].filter(Boolean).join('\n');

          return interaction.editReply({ embeds: [successEmbed(lines)] });
        } catch (err) {
          if (err.message.includes('404') || err.message.includes('No Polymart account')) {
            stmt.deleteLink.run(user.id);
          } else if (/maximum|limit/i.test(err.message)) {
            return interaction.editReply({ embeds: [errorEmbed(`Alert limit reached (${MAX_ALERTS_LINKED} max). Clear one first.`)] });
          } else {
            return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
          }
        }
      }

      if (sub === 'clear') {
        const alertId = interaction.options.getString('id').trim();
        try {
          await botApi('DELETE', `/discord/alerts/${user.id}/${alertId}`);
          return interaction.reply({ embeds: [successEmbed(`Alert #${alertId} removed.`)], ephemeral: true });
        } catch (err) {
          if (err.message.includes('404')) {
            return interaction.reply({ embeds: [errorEmbed(`Alert #${alertId} not found.`)], ephemeral: true });
          }
          if (err.message.includes('No Polymart account')) {
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

    if (sub === 'set') {
      const count = stmt.countAlerts.get(guildId, user.id)?.cnt ?? 0;
      if (count >= MAX_ALERTS_LOCAL) {
        return interaction.reply({ embeds: [errorEmbed(`You already have ${MAX_ALERTS_LOCAL} alerts. Clear one with \`/alert clear\`.`)], ephemeral: true });
      }

      let ticker, assetType;
      try {
        ticker    = validateTickerFormat(interaction.options.getString('ticker'));
        assetType = interaction.options.getString('type') ?? detectAssetType(ticker);
      } catch (err) {
        if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
        throw err;
      }

      const direction = interaction.options.getString('direction');
      const threshold = interaction.options.getNumber('price');

      if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

      let currentPrice;
      try {
        currentPrice = await getFreshPrice(ticker, assetType);
        assertValidPrice(currentPrice, ticker);
      } catch (err) {
        if (err instanceof ApiError || err instanceof ValidationError) {
          return interaction.editReply({ embeds: [errorEmbed(`Could not verify **${ticker}** — check the ticker and type.`)] });
        }
        throw err;
      }

      const existing  = stmt.getAlerts.all(guildId, user.id);
      const duplicate = existing.some(a =>
        a.ticker === ticker && a.direction === direction && Math.abs(a.threshold - threshold) < 1e-9
      );
      if (duplicate) return interaction.editReply({ embeds: [errorEmbed(`You already have this exact alert for **${ticker}**.`)] });

      stmt.insertAlert.run(guildId, interaction.channelId, user.id, ticker, assetType, direction, threshold);

      const crossed =
        (direction === 'above' && currentPrice >= threshold) ||
        (direction === 'below' && currentPrice <= threshold);

      const warning = crossed
        ? `\n⚠️ Current price ${cash(currentPrice)} already ${direction === 'above' ? 'exceeds' : 'is below'} threshold — fires next tick.`
        : `\nCurrent price: ${cash(currentPrice)}`;

      return interaction.editReply({ embeds: [successEmbed(`Alert set: **${ticker}** ${direction} ${cash(threshold)}${warning}`)] });
    }

    if (sub === 'list') {
      const alerts = stmt.getAlerts.all(guildId, user.id);
      if (!alerts.length) {
        return interaction.reply({ embeds: [errorEmbed('No active alerts. Use `/alert set` to create one.')], ephemeral: true });
      }
      const lines = alerts.map(a =>
        `\`ID ${a.id}\` **${a.ticker}** (${a.asset_type}) — ${a.direction} ${cash(a.threshold)}`
      );
      return interaction.reply({
        embeds: [polish(new EmbedBuilder()
          .setTitle('Your Price Alerts')
          .setColor(GOLD)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `${alerts.length}/${MAX_ALERTS_LOCAL} slots used · Fires in channel` }), interaction)],
        ephemeral: true,
      });
    }

    if (sub === 'clear') {
      const id = parseInt(interaction.options.getString('id'), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return interaction.reply({ embeds: [errorEmbed('Alert ID must be a positive integer.')], ephemeral: true });
      }
      const result = stmt.deleteAlert.run(id, user.id);
      if (result.changes === 0) {
        return interaction.reply({ embeds: [errorEmbed(`Alert #${id} not found or does not belong to you.`)], ephemeral: true });
      }
      return interaction.reply({ embeds: [successEmbed(`Alert #${id} removed.`)], ephemeral: true });
    }
  },
};
