import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { cash, successEmbed, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give a user bonus cash')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(0.01)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');
    const config = getConfig(interaction.guildId);

    const dbUser = getOrCreateUser(interaction.guildId, target.id, config.starting_balance);
    const newBalance = dbUser.balance + amount;
    stmt.updateBalance.run(newBalance, interaction.guildId, target.id);

    await interaction.reply({
      embeds: [successEmbed(`Gave ${cash(amount)} to **${target.username}**. New balance: ${cash(newBalance)}`)],
    });
  },
};
