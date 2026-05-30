import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateUser, getConfig, stmt } from '../../db.js';
import { cash, successEmbed, errorEmbed } from '../../utils.js';
export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily bonus'),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const config   = getConfig(guildId);
    const dbUser   = getOrCreateUser(guildId, user.id, config.starting_balance);
    const now      = Math.floor(Date.now() / 1000);
    const elapsed  = now - dbUser.last_daily;
    const cooldown = 86400;

    if (elapsed < cooldown) {
      const remaining = cooldown - elapsed;
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      return interaction.reply({ embeds: [errorEmbed(`Daily already claimed. Next in **${h}h ${m}m**.`)], ephemeral: true });
    }

    const newBalance = dbUser.balance + config.daily_bonus;
    stmt.updateBalance.run(newBalance, guildId, user.id);
    stmt.setLastDaily.run(now, guildId, user.id);

    await interaction.reply({ embeds: [successEmbed(`Claimed ${cash(config.daily_bonus)} daily bonus! New balance: ${cash(newBalance)}`)] });
  },
};
