import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, brandEmbed, GREEN, GOLD, errorEmbed } from '../../utils.js';
import { ensureUser, checkCooldown, adjust, rand, pickOne, humanDuration } from '../../casinoLib.js';
import { recordTimed, progressField } from '../../postTrade.js';
import { progressQuests } from '../../quests.js';
import { happyMultiplier } from '../../happyhour.js';

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

    // Variable-ratio surprise: ~8% of shifts pay a 3× "big tip" (bounded + cooldown-gated).
    let pay = rand(150, 600);
    const bigTip = Math.random() < 0.08;
    if (bigTip) pay *= 3;
    const hh = happyMultiplier(guildId);   // 2× faucet coins during Happy Hour
    pay = Math.round(pay * hh);

    adjust(guildId, user.id, pay);
    const prog = recordTimed({ guildId, userId: user.id, kind: 'work' }); // XP + any level-up
    try { prog.quests = progressQuests({ guildId, userId: user.id, source: 'work' }); } catch {}
    const bal  = ensureUser(guildId, user.id).balance;

    const desc = `You ${pickOne(JOBS)} and earned **${cash(pay)}**.` +
      (bigTip ? '  💰 **Big tip — 3× paycheck!**' : '') +
      (hh > 1 ? '  ⚡ **2× Happy Hour!**' : '') + `\nBalance: ${cash(bal)}`;
    const e = brandEmbed({ title: '💼 Work Shift Complete', color: bigTip ? GOLD : GREEN, interaction }).setDescription(desc);
    const f = progressField(prog); if (f) e.addFields(f);
    return interaction.reply({ embeds: [e] });
  },
};
