import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { cash, GREEN, RED, errorEmbed, polish } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet, adjust } from '../../casinoLib.js';
import { recordGame, unlockField } from '../../casinoStats.js';

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

    adjust(guildId, user.id, -bet);

    const flip = Math.random() < 0.5 ? 'heads' : 'tails';
    const won  = flip === side;
    const bal  = won ? adjust(guildId, user.id, bet * 2) : ensureUser(guildId, user.id).balance;
    const unlocked = recordGame({ guildId, userId: user.id, bet, net: won ? bet : -bet });

    const embed = new EmbedBuilder()
      .setTitle(`🪙 Coinflip — ${flip === 'heads' ? '👑 Heads' : '🪙 Tails'}`)
      .setColor(won ? GREEN : RED)
      .addFields(
        { name: 'You called', value: side === 'heads' ? '👑 Heads' : '🪙 Tails', inline: true },
        { name: won ? 'Won' : 'Lost', value: cash(bet), inline: true },
        { name: 'Balance', value: cash(bal), inline: true },
      );
    const f = unlockField(unlocked); if (f) embed.addFields(f);
    polish(embed, interaction);

    await interaction.reply({ embeds: [embed] });
  },
};
