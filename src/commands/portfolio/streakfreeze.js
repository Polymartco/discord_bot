import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, brandEmbed, errorEmbed, BLUE } from '../../utils.js';
import { ensureUser } from '../../casinoLib.js';

export const FREEZE_PRICE = 2500;
export const MAX_FREEZES  = 3;

export default {
  data: new SlashCommandBuilder()
    .setName('streakfreeze')
    .setDescription('Buy a Streak Freeze — auto-saves your daily streak if you miss a day')
    .setDMPermission(false),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const dbUser = ensureUser(guildId, user.id);

    if ((dbUser.streak_freezes ?? 0) >= MAX_FREEZES) {
      return interaction.reply({ embeds: [errorEmbed(`You already hold the max of **${MAX_FREEZES}** streak freezes.`)], ephemeral: true });
    }
    if (dbUser.balance < FREEZE_PRICE) {
      return interaction.reply({ embeds: [errorEmbed(`A streak freeze costs **${cash(FREEZE_PRICE)}** — your balance is ${cash(dbUser.balance)}.`)], ephemeral: true });
    }

    // Atomic guarded debit — safe against double-clicks and broke/at-cap races.
    const res = stmt.buyStreakFreeze.run(FREEZE_PRICE, guildId, user.id, FREEZE_PRICE, MAX_FREEZES);
    if (res.changes !== 1) {
      return interaction.reply({ embeds: [errorEmbed('Could not buy a freeze — check your balance and freeze count and try again.')], ephemeral: true });
    }

    const after = stmt.getUser.get(guildId, user.id);
    const embed = brandEmbed({ title: '❄️ Streak Freeze Purchased', color: BLUE, interaction })
      .setDescription(`Bought **1** streak freeze for **${cash(FREEZE_PRICE)}**.\nMiss a day and one is spent automatically to keep your \`/daily\` streak alive.`)
      .addFields(
        { name: 'Freezes', value: `❄️ ${after.streak_freezes}/${MAX_FREEZES}`, inline: true },
        { name: 'Balance', value: cash(after.balance),                          inline: true },
      );
    return interaction.reply({ embeds: [embed] });
  },
};
