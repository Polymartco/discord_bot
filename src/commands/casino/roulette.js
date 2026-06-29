import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { cash, GREEN, RED, errorEmbed } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet, adjust } from '../../casinoLib.js';
import { recordGame, unlockField } from '../../casinoStats.js';

// European wheel: single zero, standard red set.
const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const colorOf = n => n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black';
const EMOJI   = { red: '🔴', black: '⚫', green: '🟢' };

function parseSpace(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['red','black','green','even','odd','low','high'].includes(s)) return { kind: 'outside', value: s };
  const n = parseInt(s, 10);
  if (Number.isInteger(n) && n >= 0 && n <= 36 && String(n) === s) return { kind: 'number', value: n };
  return null;
}

// Returns gross return multiplier (incl. stake) if the bet wins, else 0.
function payoutMult(bet, result) {
  const c = colorOf(result);
  if (bet.kind === 'number') return bet.value === result ? 36 : 0;          // 35:1 + stake
  switch (bet.value) {
    case 'red':   case 'black': return c === bet.value ? 2 : 0;             // 1:1
    case 'green': return c === 'green' ? 36 : 0;
    case 'even':  return result !== 0 && result % 2 === 0 ? 2 : 0;
    case 'odd':   return result !== 0 && result % 2 === 1 ? 2 : 0;
    case 'low':   return result >= 1  && result <= 18 ? 2 : 0;
    case 'high':  return result >= 19 && result <= 36 ? 2 : 0;
    default:      return 0;
  }
}

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

    adjust(guildId, user.id, -bet);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎡 Roulette').setColor(0x5865f2).setDescription('Spinning the wheel…')] });

    const result = Math.floor(Math.random() * 37);
    const mult   = payoutMult(space, result);
    const gross  = Math.round(bet * mult);
    const bal    = gross > 0 ? adjust(guildId, user.id, gross) : ensureUser(guildId, user.id).balance;
    const net    = gross - bet;
    const won    = gross > 0;
    const pick   = space.kind === 'number' ? `#${space.value}` : space.value;

    const unlocked = recordGame({ guildId, userId: user.id, bet, net });

    const embed = new EmbedBuilder()
      .setTitle(`🎡 Roulette — ${EMOJI[colorOf(result)]} ${result} (${colorOf(result)})`)
      .setColor(won ? GREEN : RED)
      .addFields(
        { name: 'Your bet', value: `${cash(bet)} on **${pick}**`, inline: true },
        { name: won ? 'Won' : 'Lost', value: won ? cash(net) : cash(bet), inline: true },
        { name: 'Balance', value: cash(bal), inline: true },
      );
    const f = unlockField(unlocked); if (f) embed.addFields(f);

    await interaction.editReply({ embeds: [embed] });
  },
};
