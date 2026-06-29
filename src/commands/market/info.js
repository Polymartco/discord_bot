import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, colorOf, BLUE, errorEmbed } from '../../utils.js';
import { validateTickerFormat, ValidationError } from '../../validate.js';
import { respondTickerAutocomplete } from '../../autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Company profile, analyst rating, and generated news')
    .addStringOption(o => o.setName('ticker').setDescription('Stock ticker').setRequired(true).setAutocomplete(true)),

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

    let d;
    try {
      d = await api.info(ticker);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(`No info found for **${ticker}**.`)] });
      throw err;
    }

    const changePct = d.change ?? d.changePct ?? 0;

    const embed = new EmbedBuilder()
      .setTitle(`ℹ️ ${ticker} — ${d.name ?? ''}`)
      .setColor(colorOf(changePct))
      .setDescription(d.description ?? '—')
      .addFields(
        { name: 'Sector',          value: d.sector ?? '—',                      inline: true },
        { name: 'Price',           value: `$${d.price?.toFixed(2) ?? '—'}`,     inline: true },
        { name: 'Change',          value: sign(changePct),                       inline: true },
        { name: 'Analyst Rating',  value: d.analystRating ?? '—',               inline: true },
        { name: 'Macro Context',   value: d.macroContext ?? '—',                 inline: false },
      );

    const headlines = (d.news ?? []).slice(0, 3);
    if (headlines.length) {
      embed.addFields({ name: 'Headlines', value: headlines.map(h => `• ${h}`).join('\n'), inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
