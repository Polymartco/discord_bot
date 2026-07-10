import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { brandEmbed, GREEN, BLUE } from '../../utils.js';
import { ensureUser } from '../../casinoLib.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Toggle DM reminders when your daily streak is about to expire')
    .setDMPermission(false)
    .addBooleanOption(o => o.setName('enabled').setDescription('On or off (leave blank to toggle)')),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const dbUser = ensureUser(guildId, user.id);

    const opt  = interaction.options.getBoolean('enabled');
    const next = opt === null ? ((dbUser.dm_reminders ?? 0) ? 0 : 1) : (opt ? 1 : 0);
    stmt.setDmReminders.run(next, guildId, user.id);

    const embed = brandEmbed({ title: '🔔 Streak Reminders', color: next ? GREEN : BLUE, interaction })
      .setDescription(next
        ? "**On** — I'll DM you when your daily streak is about to expire. _(Make sure your DMs are open.)_"
        : '**Off** — you won\'t get streak reminder DMs.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
