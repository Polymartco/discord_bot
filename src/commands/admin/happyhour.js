import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getConfig } from '../../db.js';
import { brandEmbed, errorEmbed, successEmbed, GOLD } from '../../utils.js';
import { startHappyHour, happyHourActive, happyHourRemaining } from '../../happyhour.js';
import { humanDuration } from '../../casinoLib.js';

export default {
  data: new SlashCommandBuilder()
    .setName('happyhour')
    .setDescription('Start a 2× Happy Hour — double XP and double /work, /beg, /crate payouts (Manage Server)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('minutes').setDescription('How long to run (5–180)').setRequired(true).setMinValue(5).setMaxValue(180)),

  async execute(interaction) {
    const { guildId } = interaction;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('You need the **Manage Server** permission to start Happy Hour.')], ephemeral: true });
    }
    const config = getConfig(guildId);
    if (!config.setup_by) {
      return interaction.reply({ embeds: [errorEmbed('Run `/setup` before starting events.')], ephemeral: true });
    }
    if (happyHourActive(guildId)) {
      return interaction.reply({ embeds: [errorEmbed(`Happy Hour is already running — **${humanDuration(happyHourRemaining(guildId))}** left.`)], ephemeral: true });
    }

    const minutes = interaction.options.getInteger('minutes');
    const until   = startHappyHour(guildId, minutes);

    const embed = brandEmbed({ title: '⚡ HAPPY HOUR — 2× is LIVE!', color: GOLD, interaction })
      .setDescription(
        `Double **XP** on everything, plus **2× coins** from \`/work\`, \`/beg\`, and \`/crate\`!\n` +
        `Ends <t:${until}:R>. Get grinding! 🎰`,
      );

    // Announce to the configured channel if one is set (fire-and-forget).
    if (config.announce_channel_id) {
      interaction.client.channels.fetch(config.announce_channel_id)
        .then(ch => (ch?.isTextBased() ? ch.send({ embeds: [embed] }) : null))
        .catch(() => {});
    }
    return interaction.reply({ embeds: [config.announce_channel_id ? successEmbed(`Happy Hour started for ${minutes} minutes — announced to the channel.`, interaction) : embed] });
  },
};
