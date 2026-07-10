import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { errorEmbed } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet } from '../../casinoLib.js';
import { playRoulette, parseSpace } from '../../casinoGames.js';

export default {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Spin the roulette wheel')
    .setDMPermission(false)
    .addNumberOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('space')
      .setDescription('red, black, green, even, odd, low (1-18), high (19-36), or a number 0-36')
      .setRequired(true)),

  async execute(interaction) {
    const { guildId, user } = interaction;

    const space = parseSpace(interaction.options.getString('space'));
    if (!space) {
      return interaction.reply({ embeds: [errorEmbed('Bet on **red, black, green, even, odd, low, high**, or a **number 0-36**.')], ephemeral: true });
    }

    let bet;
    try {
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎡 Roulette').setColor(0x5865f2).setDescription('Spinning the wheel…')] });
    await interaction.editReply(playRoulette(guildId, user, bet, space, interaction));
  },
};
