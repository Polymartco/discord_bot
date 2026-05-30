import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getOrCreateUser, getConfig, resetUserData } from '../../db.js';
import { successEmbed, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resetuser')
    .setDescription('Reset a user\'s balance and holdings to defaults')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addBooleanOption(o => o.setName('confirm').setDescription('Must be true to proceed').setRequired(true)),

  async execute(interaction) {
    const confirmed = interaction.options.getBoolean('confirm');
    if (!confirmed) {
      return interaction.reply({ embeds: [errorEmbed('Set `confirm` to true to proceed.')], ephemeral: true });
    }

    const target = interaction.options.getUser('user');
    const config = getConfig(interaction.guildId);

    getOrCreateUser(interaction.guildId, target.id, config.starting_balance);
    resetUserData(interaction.guildId, target.id, config.starting_balance);

    await interaction.reply({
      embeds: [successEmbed(`Reset **${target.username}**'s account to $${config.starting_balance.toLocaleString()}.`)],
      ephemeral: true,
    });
  },
};
