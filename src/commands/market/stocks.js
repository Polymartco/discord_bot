import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { sign, colorOf, BLUE } from '../../utils.js';

const SECTOR_CHOICES = [
  'tech','ai','crypto','bio','green','finance','gaming','health','defence',
  'retail','media','auto','realty','travel','energy','logistics','agri','food',
  'space','meme',
].map(s => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: s }));

export default {
  data: new SlashCommandBuilder()
    .setName('stocks')
    .setDescription('List all stocks, optionally filtered by sector')
    .addStringOption(o =>
      o.setName('sector').setDescription('Filter by sector').addChoices(...SECTOR_CHOICES)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const sector = interaction.options.getString('sector') ?? null;
    const data   = await api.stocks(sector);

    const list = Object.values(data);
    if (!list.length) {
      return interaction.editReply({ content: 'No stocks found for that sector.' });
    }

    list.sort((a, b) => b.change - a.change);
    const top = list.slice(0, 15);

    const embed = new EmbedBuilder()
      .setTitle(sector ? `${sector.toUpperCase()} Sector Stocks` : 'All Stocks')
      .setColor(BLUE)
      .setDescription(
        top.map((s, i) =>
          `\`${String(i + 1).padStart(2)}\` **${s.ticker}** — $${s.price.toFixed(2)} ${sign(s.change)}`
        ).join('\n')
      )
      .setFooter({ text: `Showing top ${top.length} of ${list.length} by change` });

    await interaction.editReply({ embeds: [embed] });
  },
};
