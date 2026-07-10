import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { cash, brandEmbed, errorEmbed, GOLD } from '../../utils.js';
import { buildId } from '../../interactionRouter.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet } from '../../casinoLib.js';
import { createChallenge, CHALLENGE_TTL } from '../../challengeEngine.js';

export default {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Challenge another member to a winner-takes-all duel')
    .setDMPermission(false)
    .addUserOption(o => o.setName('user').setDescription('Who to challenge').setRequired(true))
    .addNumberOption(o => o.setName('bet').setDescription('Amount each side stakes').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('game').setDescription('Duel type (default high card)')
      .addChoices({ name: '🃏 High Card', value: 'highcard' }, { name: '🪙 Coinflip', value: 'coinflip' })),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const opponent = interaction.options.getUser('user');
    const game     = interaction.options.getString('game') ?? 'highcard';

    if (opponent.id === user.id) return interaction.reply({ embeds: [errorEmbed("You can't challenge yourself.")], ephemeral: true });
    if (opponent.bot)            return interaction.reply({ embeds: [errorEmbed("You can't challenge a bot.")], ephemeral: true });

    let bet;
    try {
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    let id;
    try {
      ({ id } = createChallenge({ guildId, channelId: interaction.channelId, challengerId: user.id, opponentId: opponent.id, bet, game }));
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    // ownerId = opponent → only the challenged player can accept/decline.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buildId('duel', 'accept',  opponent.id, String(id))).setLabel('⚔️ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(buildId('duel', 'decline', opponent.id, String(id))).setLabel('🏳️ Decline').setStyle(ButtonStyle.Secondary),
    );
    const embed = brandEmbed({ title: '⚔️ Duel Challenge', color: GOLD, interaction })
      .setDescription(
        `<@${user.id}> challenges <@${opponent.id}> to a **${game === 'coinflip' ? 'coinflip' : 'high-card'}** duel for **${cash(bet)}**!\n` +
        `Winner takes **${cash(bet * 2)}**. <@${opponent.id}>, accept within ${Math.round(CHALLENGE_TTL / 60)} minutes.`,
      );
    return interaction.reply({ content: `<@${opponent.id}>`, embeds: [embed], components: [row] });
  },
};
