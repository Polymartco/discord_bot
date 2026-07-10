import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet } from '../../casinoLib.js';
import { playCoinflip } from '../../casinoGames.js';

export default {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin — double or nothing')
    .setDMPermission(false)
    .addNumberOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('side').setDescription('Call it').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const side = interaction.options.getString('side');

    let bet;
    try {
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    await interaction.reply(playCoinflip(guildId, user, bet, side, interaction));
  },
};
