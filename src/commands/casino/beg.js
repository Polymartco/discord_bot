import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, brandEmbed, GREEN, GOLD, errorEmbed } from '../../utils.js';
import { ensureUser, checkCooldown, adjust, rand, pickOne, humanDuration } from '../../casinoLib.js';

const COOLDOWN = 60; // seconds

const OK = [
  'A kind stranger tossed you', 'You found some coins on the ground:',
  'A passing trader felt generous and gave you', 'Someone took pity and handed you',
];
const NONE = [
  'Nobody spared you a coin today. 😔',
  'A dog chased you off — empty-handed.',
  'You got completely ignored. Maybe try `/work`?',
];

export default {
  data: new SlashCommandBuilder()
    .setName('beg')
    .setDescription('Beg for a few coins')
    .setDMPermission(false),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const dbUser = ensureUser(guildId, user.id);

    const cd = checkCooldown(dbUser, 'last_beg', COOLDOWN);
    if (!cd.ready) {
      return interaction.reply({ embeds: [errorEmbed(`You're begging too fast — try again in **${humanDuration(cd.remaining)}**.`)], ephemeral: true });
    }
    stmt.setLastBeg.run(cd.now, guildId, user.id);

    if (Math.random() < 0.15) {
      return interaction.reply({ embeds: [brandEmbed({ title: '🥺 Begging…', color: GOLD, interaction }).setDescription(pickOne(NONE))] });
    }

    const reward = rand(1, 100);
    const bal    = adjust(guildId, user.id, reward);
    return interaction.reply({
      embeds: [brandEmbed({ title: '🥺 Begging…', color: GREEN, interaction })
        .setDescription(`${pickOne(OK)} **${cash(reward)}**.\nBalance: ${cash(bal)}`)],
    });
  },
};
