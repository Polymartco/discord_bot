import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, GREEN, RED, errorEmbed, sectorHeatmapAttachment, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('heatmap')
    .setDescription('Sector performance heatmap — average % change per sector as a bar chart'),

  async execute(interaction) {
    await interaction.deferReply();

    let stocks;
    try {
      stocks = await api.stocks();
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    // Compute sector averages for embed fields
    const sectorMap = {};
    for (const [, s] of Object.entries(stocks)) {
      const sec = s.sector;
      if (!sec) continue;
      if (!sectorMap[sec]) sectorMap[sec] = { total: 0, count: 0 };
      sectorMap[sec].total += s.change ?? 0;
      sectorMap[sec].count++;
    }

    const sorted = Object.entries(sectorMap)
      .map(([name, { total, count }]) => ({ name, pct: count > 0 ? total / count : 0 }))
      .sort((a, b) => b.pct - a.pct);

    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];
    const bullish = sorted.filter(s => s.pct > 0).length;
    const bearish = sorted.filter(s => s.pct < 0).length;

    const att = sectorHeatmapAttachment(stocks);

    const embed = new EmbedBuilder()
      .setTitle('📊 Sector Heatmap')
      .setColor(best?.pct >= 0 ? GREEN : RED)
      .addFields(
        { name: '🟢 Best',     value: best  ? `**${best.name}** ${sign(best.pct)}`   : '—', inline: true },
        { name: '🔴 Worst',    value: worst ? `**${worst.name}** ${sign(worst.pct)}` : '—', inline: true },
        { name: 'Sectors',     value: String(sorted.length),                                inline: true },
        { name: 'Bullish',     value: String(bullish),                                      inline: true },
        { name: 'Bearish',     value: String(bearish),                                      inline: true },
      );

    if (att) embed.setImage('attachment://heatmap.png');

    await interaction.editReply({ embeds: [polish(embed, interaction)], ...(att ? { files: [att] } : {}) });
  },
};
