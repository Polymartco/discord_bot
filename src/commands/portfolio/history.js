import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { botApi } from '../../botApi.js';
import { cash, BLUE, errorEmbed, polish } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Your recent order history')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guildId, user } = interaction;
    const page = interaction.options.getInteger('page') ?? 1;

    // ── Linked path — server order history ───────────────────────────────────
    const link = stmt.getLink.get(user.id);
    if (link) {
      try {
        const data   = await botApi('GET', `/discord/history/${user.id}?page=${page}&limit=10&portfolioId=${link.portfolio_id}`);
        const orders = data.orders ?? (Array.isArray(data) ? data : []);

        if (!orders.length) {
          return interaction.editReply({ content: page === 1 ? 'No orders found on your Polymart account.' : 'No orders on this page.' });
        }

        const lines = orders.map(o => {
          const date  = new Date(o.executedAt ?? o.created_at ?? Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const side  = (o.side ?? '?').toUpperCase().padEnd(4);
          const sym   = o.symbol ?? o.ticker ?? '?';
          const qty   = (o.quantity ?? o.shares ?? 0).toLocaleString();
          const price = cash(o.executedPrice ?? o.price ?? 0);
          const total = cash(o.total ?? 0);
          const pnl   = o.realizedPnl != null ? ` · P&L: ${cash(o.realizedPnl)}` : '';
          return `\`${date}\` **${side}** ${sym} — ${qty}×${price} = ${total}${pnl}`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`Order History — Page ${page}`)
          .setColor(BLUE)
          .setDescription(lines.join('\n'))
          .setFooter({ text: '🔗 Synced from polymart.co' });

        return interaction.editReply({ embeds: [polish(embed, interaction)] });
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('No Polymart account')) {
          stmt.deleteLink.run(user.id);
        } else {
          return interaction.editReply({ embeds: [errorEmbed(`Polymart: ${err.message}`)] });
        }
      }
    }

    // ── Local SQLite path ─────────────────────────────────────────────────────
    const config = getConfig(guildId);
    getOrCreateUser(guildId, user.id, config.starting_balance);

    const trades = stmt.getTrades.all(guildId, user.id, 10, (page - 1) * 10);
    if (!trades.length) {
      return interaction.editReply({ content: page === 1 ? 'You have no trades yet.' : 'No trades on this page.' });
    }

    const lines = trades.map(t => {
      const date = new Date(t.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const side = t.side.toUpperCase().padEnd(4);
      return `\`${date}\` **${side}** ${t.ticker} — ${t.shares}×${cash(t.price)} = ${cash(t.total)} (fee ${cash(t.fee)})`;
    });

    await interaction.editReply({
      embeds: [polish(new EmbedBuilder().setTitle(`Trade History — Page ${page}`).setColor(BLUE).setDescription(lines.join('\n')), interaction)],
    });
  },
};
