import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { GOLD, errorEmbed } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet } from '../../casinoLib.js';
import { playSlots } from '../../casinoGames.js';

export default {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine — triple 7s win the progressive jackpot')
    .setDMPermission(false)
    .addNumberOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const { guildId, user } = interaction;

    let bet;
    try {
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    // Suspense: two spinning frames, then reveal the settled result. Only the
    // final editReply calls playSlots(), so the game is settled exactly once.
    const SYM   = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
    const rnd   = () => SYM[Math.floor(Math.random() * SYM.length)];
    const frame = () => new EmbedBuilder().setTitle('🎰 Slots').setColor(GOLD).setDescription(`**${rnd()} │ ${rnd()} │ ${rnd()}**\n\nSpinning…`);
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    await interaction.reply({ embeds: [frame()] });
    await sleep(600);
    await interaction.editReply({ embeds: [frame()] });
    await sleep(600);
    await interaction.editReply(playSlots(guildId, user, bet, interaction));
  },
};
