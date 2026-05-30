import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { stmt, getConfig, updateChannelConfig } from '../../db.js';
import { GOLD, successEmbed, errorEmbed } from '../../utils.js';

// ── Bounds for config values ──────────────────────────────────────────────────
const BOUNDS = {
  starting_balance: { min: 100,    max: 100_000_000, label: 'Starting Balance', unit: '$' },
  daily_bonus:      { min: 0,      max: 1_000_000,   label: 'Daily Bonus',      unit: '$' },
  trading_fee:      { min: 0,      max: 10,           label: 'Trading Fee',      unit: '%' },
};

export default {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('View or update server configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('view').setDescription('Show current configuration'))
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Update a configuration value')
        .addStringOption(o =>
          o.setName('key').setDescription('Setting to change').setRequired(true)
            .addChoices(
              { name: 'Starting Balance', value: 'starting_balance' },
              { name: 'Daily Bonus',      value: 'daily_bonus'      },
              { name: 'Trading Fee %',    value: 'trading_fee'      },
            )
        )
        .addNumberOption(o => o.setName('value').setDescription('New value').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('setchannel')
        .setDescription('Set a channel override')
        .addStringOption(o =>
          o.setName('type').setDescription('Channel type').setRequired(true)
            .addChoices(
              { name: 'Trades',        value: 'trade_channel_id'    },
              { name: 'Alerts',        value: 'alert_channel_id'    },
              { name: 'Announcements', value: 'announce_channel_id' },
            )
        )
        .addChannelOption(o =>
          o.setName('channel').setDescription('Channel to use').setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    ),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── view ──────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      const cfg = getConfig(guildId);
      const embed = new EmbedBuilder()
        .setTitle('Server Configuration')
        .setColor(GOLD)
        .addFields(
          { name: 'Starting Balance', value: `$${cfg.starting_balance.toLocaleString()}`,  inline: true },
          { name: 'Daily Bonus',      value: `$${cfg.daily_bonus.toLocaleString()}`,        inline: true },
          { name: 'Trading Fee',      value: `${(cfg.trading_fee_pct * 100).toFixed(2)}%`, inline: true },
          { name: 'Trade Channel',    value: cfg.trade_channel_id    ? `<#${cfg.trade_channel_id}>`    : '—', inline: true },
          { name: 'Alert Channel',    value: cfg.alert_channel_id    ? `<#${cfg.alert_channel_id}>`    : '—', inline: true },
          { name: 'Announce Channel', value: cfg.announce_channel_id ? `<#${cfg.announce_channel_id}>` : '—', inline: true },
          { name: 'Set up by',        value: cfg.setup_by ? `<@${cfg.setup_by}>` : '—', inline: true },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── set ───────────────────────────────────────────────────────────────────
    if (sub === 'set') {
      const key   = interaction.options.getString('key');
      const value = interaction.options.getNumber('value');
      const bound = BOUNDS[key];

      // Bounds validation
      if (!Number.isFinite(value)) {
        return interaction.reply({ embeds: [errorEmbed('Value must be a finite number.')], ephemeral: true });
      }
      if (value < bound.min || value > bound.max) {
        return interaction.reply({
          embeds: [errorEmbed(`${bound.label} must be between ${bound.unit}${bound.min.toLocaleString()} and ${bound.unit}${bound.max.toLocaleString()}.`)],
          ephemeral: true,
        });
      }

      const cfg        = getConfig(guildId);
      const newStarting = key === 'starting_balance' ? value       : cfg.starting_balance;
      const newBonus    = key === 'daily_bonus'       ? value       : cfg.daily_bonus;
      const newFee      = key === 'trading_fee'       ? value / 100 : cfg.trading_fee_pct;

      stmt.upsertConfig.run(guildId, newStarting, newFee, newBonus, cfg.setup_by ?? interaction.user.id);
      return interaction.reply({
        embeds: [successEmbed(`Updated **${bound.label}** to \`${bound.unit}${value.toLocaleString()}\`.`)],
        ephemeral: true,
      });
    }

    // ── setchannel ────────────────────────────────────────────────────────────
    if (sub === 'setchannel') {
      const type    = interaction.options.getString('type');
      const channel = interaction.options.getChannel('channel');
      updateChannelConfig(guildId, interaction.user.id, type, channel.id);
      const typeName = type.replace('_channel_id', '');
      return interaction.reply({
        embeds: [successEmbed(`Set <#${channel.id}> as the **${typeName}** channel.`)],
        ephemeral: true,
      });
    }
  },
};
