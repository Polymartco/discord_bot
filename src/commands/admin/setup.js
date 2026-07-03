import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { stmt } from '../../db.js';
import { GOLD, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the Polymart bot for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addNumberOption(o => o.setName('starting_balance').setDescription('Starting balance per user (default: 10000)'))
    .addNumberOption(o => o.setName('daily_bonus').setDescription('Daily bonus amount (default: 500)'))
    .addNumberOption(o => o.setName('trading_fee').setDescription('Trading fee % e.g. 0.1 for 0.1% (default: 0.1)')),

  async execute(interaction) {
    const startingBalance = interaction.options.getNumber('starting_balance') ?? 10000;
    const dailyBonus      = interaction.options.getNumber('daily_bonus')      ?? 500;
    const feePct          = (interaction.options.getNumber('trading_fee')     ?? 0.1) / 100;

    stmt.upsertConfig.run(interaction.guildId, startingBalance, feePct, dailyBonus, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('✅ Polymart Bot Configured')
      .setColor(GOLD)
      .addFields(
        { name: 'Starting Balance', value: `$${startingBalance.toLocaleString()}`, inline: true },
        { name: 'Daily Bonus',      value: `$${dailyBonus.toLocaleString()}`,      inline: true },
        { name: 'Trading Fee',      value: `${(feePct * 100).toFixed(2)}%`,        inline: true },
      )
      .setDescription('Users can now use `/balance`, `/buy`, `/sell`, and all portfolio commands.\nRun `/config` to update settings or set channel overrides.');

    await interaction.reply({ embeds: [polish(embed, interaction)] });
  },
};
