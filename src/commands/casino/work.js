import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, brandEmbed, GREEN, errorEmbed } from '../../utils.js';
import { ensureUser, checkCooldown, adjust, rand, pickOne, humanDuration } from '../../casinoLib.js';

const COOLDOWN = 600; // 10 minutes

const JOBS = [
  'pulled an all-nighter day-trading meme stocks',
  'flipped burgers at PolyBurger',
  'wrote market commentary nobody read',
  'walked the CEO’s dog',
  'fixed a bug in the trading engine',
  'delivered packages across the trading floor',
  'manned the Polymart help desk',
  'cleaned the casino floor after a big win',
];

export default {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work a shift for a paycheck')
    .setDMPermission(false),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const dbUser = ensureUser(guildId, user.id);

    const cd = checkCooldown(dbUser, 'last_work', COOLDOWN);
    if (!cd.ready) {
      return interaction.reply({ embeds: [errorEmbed(`You're on a break — next shift in **${humanDuration(cd.remaining)}**.`)], ephemeral: true });
    }
    stmt.setLastWork.run(cd.now, guildId, user.id);

    const pay = rand(150, 600);
    const bal = adjust(guildId, user.id, pay);
    return interaction.reply({
      embeds: [brandEmbed({ title: '💼 Work Shift Complete', color: GREEN, interaction })
        .setDescription(`You ${pickOne(JOBS)} and earned **${cash(pay)}**.\nBalance: ${cash(bal)}`)],
    });
  },
};
