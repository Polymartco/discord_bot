import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { getConfig } from '../../db.js';
import { sign, colorOf, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a live market update to the announce channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const config = getConfig(interaction.guildId);

    if (!config.announce_channel_id) {
      return interaction.editReply({ embeds: [errorEmbed('No announce channel set. Use `/config setchannel` first.')] });
    }

    let market, movers;
    try {
      [market, movers] = await Promise.all([api.market(), api.topMovers(3)]);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(`Market API unavailable: ${err.message}`)] });
      throw err;
    }

    const indexChange = market?.indexChangePct ?? market?.indexChange ?? 0;
    const gainers = Array.isArray(movers?.gainers) ? movers.gainers : [];
    const losers  = Array.isArray(movers?.losers)  ? movers.losers  : [];

    const fmtMovers = arr => arr.slice(0, 3)
      .map(s => `**${s.ticker ?? '?'}** ${sign(s.change ?? 0)}`)
      .join('\n') || '—';

    const embed = new EmbedBuilder()
      .setTitle('📡 Market Update')
      .setColor(colorOf(indexChange))
      .addFields(
        { name: 'Market Index',   value: `${market?.index?.toFixed(2) ?? '—'} (${sign(indexChange)})`,                 inline: true },
        { name: 'Fear & Greed',   value: `${market?.fearGreed ?? '—'} — ${market?.fearGreedLabel ?? ''}`,               inline: true },
        { name: 'VIX',            value: market?.vix?.toFixed(2) ?? '—',                                                inline: true },
        { name: '📈 Top Gainers', value: fmtMovers(gainers),                                                            inline: true },
        { name: '📉 Top Losers',  value: fmtMovers(losers),                                                             inline: true },
      )
      .setTimestamp();

    try {
      const channel = await interaction.client.channels.fetch(config.announce_channel_id);
      if (!channel?.isTextBased()) {
        return interaction.editReply({ embeds: [errorEmbed('Announce channel is not a text channel.')] });
      }
      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: `✅ Announcement sent to <#${config.announce_channel_id}>.` });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Could not send to channel: ${err.message}`)] });
    }
  },
};
