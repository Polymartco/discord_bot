import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { updateChannelConfig } from '../../db.js';
import { successEmbed } from '../../utils.js';

const CHANNEL_COLUMNS = {
  trades:        'trade_channel_id',
  alerts:        'alert_channel_id',
  announcements: 'announce_channel_id',
};

export default {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set channel overrides for trades, alerts, or announcements')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('type').setDescription('Which channel type to set').setRequired(true)
        .addChoices(
          { name: 'Trades',        value: 'trades'        },
          { name: 'Alerts',        value: 'alerts'        },
          { name: 'Announcements', value: 'announcements' },
        )
    )
    .addChannelOption(o =>
      o.setName('channel').setDescription('Channel to use').setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    const type    = interaction.options.getString('type');
    const channel = interaction.options.getChannel('channel');
    const column  = CHANNEL_COLUMNS[type];

    updateChannelConfig(interaction.guildId, interaction.user.id, column, channel.id);

    await interaction.reply({
      embeds: [successEmbed(`Set <#${channel.id}> as the **${type}** channel.`)],
      ephemeral: true,
    });
  },
};
