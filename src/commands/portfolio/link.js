import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { botApi } from '../../botApi.js';
import { GOLD, errorEmbed, cash } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord to your polymart.co account for portfolio sync')
    .addStringOption(o =>
      o.setName('code')
       .setDescription('6-digit code from polymart.co/account')
       .setRequired(true)
       .setMinLength(6)
       .setMaxLength(7)  // allow "123 456" with space
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const rawCode = interaction.options.getString('code').replace(/\s/g, '');
    if (!/^\d{6}$/.test(rawCode)) {
      return interaction.editReply({ embeds: [errorEmbed('Code must be a 6-digit number.')] });
    }

    const existing = stmt.getLink.get(interaction.user.id);
    if (existing) {
      return interaction.editReply({
        embeds: [errorEmbed(`Already linked to **${existing.display_name ?? 'a Polymart account'}**. Run \`/unlink\` first.`)],
      });
    }

    let result;
    try {
      result = await botApi('POST', '/discord/verify', {
        code:            rawCode,
        discordUserId:   interaction.user.id,
        discordUsername: interaction.user.username,
      });
    } catch (err) {
      const msg = err.message.toLowerCase();
      if (msg.includes('expired') || msg.includes('not found') || msg.includes('already used')) {
        return interaction.editReply({
          embeds: [errorEmbed('Code not found, expired, or already used. Generate a fresh one at polymart.co/account.')],
        });
      }
      return interaction.editReply({ embeds: [errorEmbed(`Link failed: ${err.message}`)] });
    }

    stmt.saveLink.run(
      interaction.user.id,
      result.clerkId,
      result.defaultPortfolioId,
      result.displayName,
    );

    const embed = new EmbedBuilder()
      .setTitle('✅ Linked to Polymart')
      .setColor(GOLD)
      .setDescription(
        `Your Discord is now linked to **${result.displayName}** on polymart.co.\n` +
        `Your trades and portfolio are synced — use \`/portfolio\` or \`/balance\` to check.`
      )
      .addFields(
        { name: 'Portfolio', value: result.portfolioName ?? 'Default', inline: true },
        {
          name:   'Cash',
          value:  result.cashBalance != null ? cash(Number(result.cashBalance)) : '—',
          inline: true,
        },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
