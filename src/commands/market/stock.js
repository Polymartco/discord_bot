import { SlashCommandBuilder } from 'discord.js';
import { ApiError } from '../../api.js';
import { errorEmbed } from '../../utils.js';
import { validateTickerFormat, ValidationError } from '../../validate.js';
import { respondTickerAutocomplete } from '../../autocomplete.js';
import { buildStockCard } from '../../cards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Get detailed stock info with price chart')
    .addStringOption(o => o.setName('ticker').setDescription('Stock ticker e.g. APEX').setRequired(true).setAutocomplete(true)),

  autocomplete: (interaction) => respondTickerAutocomplete(interaction, 'stock'),

  async execute(interaction) {
    await interaction.deferReply();

    let ticker;
    try {
      ticker = validateTickerFormat(interaction.options.getString('ticker'));
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    try {
      await interaction.editReply(await buildStockCard(interaction, ticker, 'stock'));
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(`**${ticker}** not found. Check the ticker and try again.`)] });
      throw err;
    }
  },
};
