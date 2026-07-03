import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { botApi } from '../../botApi.js';
import { cash, BLUE, errorEmbed, successEmbed, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pending')
    .setDescription('View and cancel pending limit/stop orders on Polymart')
    .addSubcommand(s => s.setName('list').setDescription('List all pending orders'))
    .addSubcommand(s =>
      s.setName('cancel')
        .setDescription('Cancel a pending order by ID')
        .addStringOption(o =>
          o.setName('id').setDescription('Order ID (from /pending list)').setRequired(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { user } = interaction;

    const link = stmt.getLink.get(user.id);
    if (!link) {
      return interaction.editReply({
        embeds: [errorEmbed('Pending orders require a linked Polymart account. Use `/link` to connect.')],
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      let orders;
      try {
        const data = await botApi('GET', `/discord/pending/${user.id}?portfolioId=${link.portfolio_id}`);
        orders = data.orders ?? (Array.isArray(data) ? data : []);
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('No Polymart account')) {
          stmt.deleteLink.run(user.id);
          return interaction.editReply({ embeds: [errorEmbed('Polymart account not found. Please re-link with `/link`.')] });
        }
        return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
      }

      if (!orders.length) {
        return interaction.editReply({ content: 'No pending orders. Place limit or stop orders at polymart.co.' });
      }

      const lines = orders.map(o => {
        const sym   = o.symbol ?? o.ticker ?? '?';
        const side  = (o.side ?? '?').toUpperCase();
        const type  = o.orderType ?? o.type ?? 'limit';
        const qty   = (o.quantity ?? o.shares ?? 0).toLocaleString();
        const price = cash(o.triggerPrice ?? o.limitPrice ?? o.price ?? 0);
        return `\`ID ${o.id}\` **${side}** ${sym} ${type} — ${qty} @ ${price}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('Pending Orders')
        .setColor(BLUE)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${orders.length} pending order${orders.length === 1 ? '' : 's'} · 🔗 polymart.co` });

      return interaction.editReply({ embeds: [polish(embed, interaction)] });
    }

    // ── cancel ────────────────────────────────────────────────────────────────
    if (sub === 'cancel') {
      const orderId = interaction.options.getString('id').trim();

      try {
        await botApi('DELETE', `/discord/pending/${user.id}/${orderId}`);
        return interaction.editReply({ embeds: [successEmbed(`Order #${orderId} cancelled.`)] });
      } catch (err) {
        if (err.message.includes('404')) {
          return interaction.editReply({ embeds: [errorEmbed(`Order #${orderId} not found or already filled.`)] });
        }
        if (err.message.includes('No Polymart account')) {
          stmt.deleteLink.run(user.id);
          return interaction.editReply({ embeds: [errorEmbed('Polymart account not found. Please re-link with `/link`.')] });
        }
        return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
      }
    }
  },
};
