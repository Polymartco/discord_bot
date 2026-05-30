import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt, getConfig, getOrCreateUser } from '../../db.js';
import { detectAssetType, getFreshPrice, ApiError } from '../../api.js';
import { GOLD, errorEmbed, successEmbed, cash } from '../../utils.js';
import {
  ValidationError,
  validateTickerFormat,
  assertGuildSetup,
  assertValidPrice,
} from '../../validate.js';

const MAX_ALERTS = 5;

export default {
  data: new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Set, list, or clear price alerts')
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Set a price alert')
        .addStringOption(o => o.setName('ticker').setDescription('Ticker/symbol/pair').setRequired(true))
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
    )
    .addSubcommand(s => s.setName('list').setDescription('List your active alerts'))
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription('Clear an alert by ID')
        .addIntegerOption(o => o.setName('id').setDescription('Alert ID').setRequired(true))
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

    // ── set ───────────────────────────────────────────────────────────────────
    if (sub === 'set') {
      // Cap check first (cheap)
      const count = stmt.countAlerts.get(guildId, user.id)?.cnt ?? 0;
      if (count >= MAX_ALERTS) {
        return interaction.reply({ embeds: [errorEmbed(`You already have ${MAX_ALERTS} alerts. Clear one with \`/alert clear\`.`)], ephemeral: true });
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

      if (threshold <= 0) {
        return interaction.reply({ embeds: [errorEmbed('Target price must be greater than zero.')], ephemeral: true });
      }

      // Verify asset and get live price (shows user if threshold already crossed)
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

      // Warn if the threshold is already crossed (alert would fire immediately or never)
      const alreadyCrossed =
        (direction === 'above' && currentPrice >= threshold) ||
        (direction === 'below' && currentPrice <= threshold);

      // Check for duplicate alert (same ticker + direction + threshold)
      const existing = stmt.getAlerts.all(guildId, user.id);
      const duplicate = existing.some(a =>
        a.ticker === ticker &&
        a.direction === direction &&
        Math.abs(a.threshold - threshold) < 1e-9
      );
      if (duplicate) {
        return interaction.editReply({ embeds: [errorEmbed(`You already have this exact alert for **${ticker}**.`)] });
      }

      stmt.insertAlert.run(guildId, interaction.channelId, user.id, ticker, assetType, direction, threshold);

      const warningLine = alreadyCrossed
        ? `\n⚠️ Current price is ${cash(currentPrice)} — threshold already ${direction === 'above' ? 'exceeded' : 'undercut'}. Alert will fire on next tick.`
        : `\nCurrent price: ${cash(currentPrice)}`;

      return interaction.editReply({
        embeds: [successEmbed(`Alert set: **${ticker}** ${direction} ${cash(threshold)}${warningLine}`)],
      });
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const alerts = stmt.getAlerts.all(guildId, user.id);
      if (!alerts.length) {
        return interaction.reply({ embeds: [errorEmbed('You have no active alerts. Use `/alert set` to create one.')], ephemeral: true });
      }

      const lines = alerts.map(a =>
        `\`ID ${a.id}\` **${a.ticker}** (${a.asset_type}) — ${a.direction} ${cash(a.threshold)}`
      );

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('Your Price Alerts')
          .setColor(GOLD)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `${alerts.length}/${MAX_ALERTS} slots used` })],
        ephemeral: true,
      });
    }

    // ── clear ─────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const id = interaction.options.getInteger('id');
      if (id <= 0) {
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
