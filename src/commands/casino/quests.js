import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { brandEmbed, compact, GOLD, BLUE } from '../../utils.js';
import { buildId } from '../../interactionRouter.js';
import { progressBar } from '../../progression.js';
import { questBoard } from '../../quests.js';
import { ensureUser } from '../../casinoLib.js';

/** One quest → a display line with a progress bar and status marker. */
function questLine(q) {
  const fmt   = n => (n >= 1000 ? compact(n).replace('$', '') : String(Math.floor(n)));
  const marker = q.claimed ? '✅' : q.claimable ? '🎁' : '▫️';
  const bar    = progressBar(q.goal ? q.progress / q.goal : 0);
  const status = q.claimed ? ' — _claimed_' : q.claimable ? ' — **ready!**' : '';
  return `${marker} ${q.emoji} **${q.name}** — ${q.desc}\n ${bar} ${fmt(q.progress)}/${fmt(q.goal)} · 💰 ${compact(q.reward)} · ✨ ${q.xp} XP${status}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Your daily & weekly quests — finish them for coins and XP')
    .setDMPermission(false),

  async execute(interaction) {
    const { guildId, user } = interaction;
    ensureUser(guildId, user.id);
    const board = questBoard(guildId, user.id);

    const claimable = [...board.daily, ...board.weekly].filter(q => q.claimable);
    const payout    = claimable.reduce((s, q) => s + q.reward, 0);

    const embed = brandEmbed({ title: '🎯 Your Quests', color: claimable.length ? GOLD : BLUE, interaction })
      .setDescription(claimable.length
        ? `You have **${claimable.length}** quest${claimable.length === 1 ? '' : 's'} ready — claim **${compact(payout)}** below!`
        : 'Play games, work shifts, and claim your daily to complete these. Rewards reset each period.')
      .addFields(
        { name: '📅 Daily  ·  resets at UTC midnight', value: board.daily.map(questLine).join('\n') || '_none_', inline: false },
        { name: '🗓️ Weekly  ·  resets Monday',        value: board.weekly.map(questLine).join('\n') || '_none_', inline: false },
      );

    const components = [];
    if (claimable.length) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('quest', 'claimall', user.id))
          .setLabel(`🎁 Claim All · ${compact(payout)}`)
          .setStyle(ButtonStyle.Success),
      ));
    }

    await interaction.reply({ embeds: [embed], components });
  },
};
