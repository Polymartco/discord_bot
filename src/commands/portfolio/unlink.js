import { SlashCommandBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { botApi } from '../../botApi.js';
import { successEmbed, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Disconnect your Discord from your polymart.co account'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const link = stmt.getLink.get(interaction.user.id);
    if (!link) {
      return interaction.editReply({
        embeds: [errorEmbed('Your Discord is not linked to any Polymart account.')],
      });
    }

    try {
      await botApi('DELETE', `/discord/user/${interaction.user.id}`);
    } catch (err) {
      // If the server already removed the link (404), still clean up locally
      if (!err.message.includes('404')) {
        return interaction.editReply({ embeds: [errorEmbed(`Unlink failed: ${err.message}`)] });
      }
    }

    stmt.deleteLink.run(interaction.user.id);

    await interaction.editReply({
      embeds: [successEmbed('Unlinked from Polymart. Future trades in this server will use your local balance.')],
    });
  },
};
