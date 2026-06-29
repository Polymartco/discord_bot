import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, brandEmbed, GOLD } from '../../utils.js';
import { jackpotPool } from '../../casinoStats.js';

export default {
  data: new SlashCommandBuilder()
    .setName('casinostats')
    .setDescription('View lifetime casino stats')
    .setDMPermission(false)
    .addUserOption(o => o.setName('user').setDescription('Whose stats to view')),

  async execute(interaction) {
    await interaction.deferReply();
    const { guildId } = interaction;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const s = stmt.getCasinoStats.get(guildId, target.id);

    if (!s || s.games === 0) {
      return interaction.editReply({ embeds: [brandEmbed({ title: `🎰 ${target.username}'s Casino Stats`, color: GOLD, interaction })
        .setDescription('No games played yet. Try `/slots`, `/blackjack`, `/roulette`, `/mines`, or `/coinflip`!')] });
    }

    const winRate = (s.wins / s.games) * 100;
    const streak  = s.cur_streak > 0 ? `🔥 ${s.cur_streak} win streak`
                  : s.cur_streak < 0 ? `❄️ ${-s.cur_streak} loss streak` : '—';

    const embed = brandEmbed({ title: `🎰 ${target.username}'s Casino Stats`, color: GOLD, interaction })
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Games',         value: String(s.games),                       inline: true },
        { name: 'Wins',          value: `${s.wins} (${winRate.toFixed(1)}%)`,   inline: true },
        { name: 'Net Profit',    value: cash(s.net),                            inline: true },
        { name: 'Total Wagered', value: cash(s.wagered),                        inline: true },
        { name: 'Biggest Win',   value: cash(s.biggest_win),                    inline: true },
        { name: 'Best Streak',   value: String(s.best_streak),                  inline: true },
        { name: 'Current',       value: streak,                                 inline: false },
      )
      .setFooter({ text: `💰 Server jackpot pool: ${cash(jackpotPool(guildId))}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
