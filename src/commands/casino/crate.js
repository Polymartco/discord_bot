import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, brandEmbed, GREEN, GOLD, errorEmbed } from '../../utils.js';
import { ensureUser, checkCooldown, adjust, rand, humanDuration } from '../../casinoLib.js';
import { recordTimed, progressField } from '../../postTrade.js';
import { happyMultiplier } from '../../happyhour.js';

const COOLDOWN = 3600; // 1 hour

// Weighted loot tiers — most crates are small, a legendary is rare & juicy.
const TIERS = [
  { w: 60, min: 100,  max: 400,   emoji: '📦', label: 'Common crate'    },
  { w: 28, min: 400,  max: 1000,  emoji: '🎁', label: 'Rare crate'      },
  { w: 10, min: 1000, max: 2500,  emoji: '💠', label: 'Epic crate'      },
  { w: 2,  min: 5000, max: 10000, emoji: '🌟', label: 'LEGENDARY crate' },
];
const TOTAL_W = TIERS.reduce((s, t) => s + t.w, 0);
function rollTier() {
  let r = Math.random() * TOTAL_W;
  for (const t of TIERS) if ((r -= t.w) < 0) return t;
  return TIERS[0];
}

export default {
  data: new SlashCommandBuilder()
    .setName('crate')
    .setDescription('Open a free loot crate — once an hour, small chance of a legendary')
    .setDMPermission(false),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const dbUser = ensureUser(guildId, user.id);

    const cd = checkCooldown(dbUser, 'last_crate', COOLDOWN);
    if (!cd.ready) {
      return interaction.reply({ embeds: [errorEmbed(`No crate ready yet — next one in **${humanDuration(cd.remaining)}**.`)], ephemeral: true });
    }
    stmt.setLastCrate.run(cd.now, guildId, user.id);

    const tier   = rollTier();
    const hh     = happyMultiplier(guildId);
    const reward = rand(tier.min, tier.max) * hh;
    adjust(guildId, user.id, reward);
    const prog = recordTimed({ guildId, userId: user.id, kind: 'crate' }); // XP + any level-up
    const bal  = ensureUser(guildId, user.id).balance;

    const legendary = tier.label.startsWith('LEG');
    const embed = brandEmbed({ title: `${tier.emoji} ${tier.label} opened!`, color: legendary ? GOLD : GREEN, interaction })
      .setDescription(`You found **${cash(reward)}**!${legendary ? ' 🎉🎉' : ''}${hh > 1 ? '  ⚡ **2× Happy Hour!**' : ''}\nBalance: ${cash(bal)}`);
    const f = progressField(prog); if (f) embed.addFields(f);
    return interaction.reply({ embeds: [embed] });
  },
};
