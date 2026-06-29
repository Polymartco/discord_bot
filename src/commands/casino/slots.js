import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { cash, GREEN, RED, GOLD, errorEmbed } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet, adjust } from '../../casinoLib.js';
import { recordGame, unlockField, jackpotPool, contributeJackpot, awardJackpot } from '../../casinoStats.js';

// Weighted reel — rarer symbols pay more. m = 3-of-a-kind multiplier.
const REEL = [
  { e: '🍒', w: 30, m: 3  },
  { e: '🍋', w: 25, m: 4  },
  { e: '🔔', w: 20, m: 6  },
  { e: '⭐', w: 13, m: 10 },
  { e: '💎', w: 8,  m: 20 },
  { e: '7️⃣', w: 4,  m: 50 },
];
const TOTAL_W = REEL.reduce((s, x) => s + x.w, 0);

function spin() {
  let r = Math.random() * TOTAL_W;
  for (const x of REEL) if ((r -= x.w) < 0) return x;
  return REEL[0];
}

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

    adjust(guildId, user.id, -bet);
    contributeJackpot(guildId, bet);

    const reels = [spin(), spin(), spin()];
    const line  = reels.map(r => r.e).join(' │ ');

    let gross = 0, note = 'No win — better luck next spin!', jackpotHit = false;
    if (reels[0].e === reels[1].e && reels[1].e === reels[2].e) {
      gross = Math.round(bet * reels[0].m);
      if (reels[0].e === '7️⃣') {
        jackpotHit = true;
        const pool = awardJackpot(guildId);
        gross += Math.round(pool);
        note = `🎰 **JACKPOT!!!** Triple 7s win the ${cash(pool)} pool!`;
      } else {
        note = `Three ${reels[0].e} — ${reels[0].m}×!`;
      }
    } else {
      const cherries = reels.filter(r => r.e === '🍒').length;
      if (cherries === 2) { gross = Math.round(bet * 2); note = 'Two 🍒 — 2×!'; }
    }

    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎰 Slots').setColor(GOLD).setDescription('🎲 │ 🎲 │ 🎲\n\nSpinning…')] });

    const bal = gross > 0 ? adjust(guildId, user.id, gross) : ensureUser(guildId, user.id).balance;
    const net = gross - bet;
    const won = gross > 0;
    const unlocked = recordGame({ guildId, userId: user.id, bet, net, flags: { jackpot: jackpotHit } });

    const embed = new EmbedBuilder()
      .setTitle('🎰 Slots')
      .setColor(won ? GREEN : RED)
      .setDescription(`**${line}**\n\n${note}`)
      .addFields(
        { name: 'Bet',       value: cash(bet), inline: true },
        { name: won ? 'Won' : 'Lost', value: won ? cash(net) : cash(bet), inline: true },
        { name: 'Balance',   value: cash(bal), inline: true },
      )
      .setFooter({ text: `💰 Jackpot pool: ${cash(jackpotPool(guildId))}` });
    const f = unlockField(unlocked); if (f) embed.addFields(f);

    await interaction.editReply({ embeds: [embed] });
  },
};
