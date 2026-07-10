import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { cash, BLUE, errorEmbed, polish } from '../../utils.js';
import { ValidationError, validateTickerFormat } from '../../validate.js';
import { ApiError, detectAssetType } from '../../api.js';
import { ensureUser, validateBet } from '../../casinoLib.js';
import { createPrediction, HORIZONS, DEFAULT_HORIZON } from '../../predictions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('predict')
    .setDescription('Bet on which way a stock/crypto/forex asset moves — auto-settles for a 1.95× payout')
    .setDMPermission(false)
    .addStringOption(o => o.setName('ticker').setDescription('Asset ticker (e.g. AAPL, BTCX, EURUSD)').setRequired(true))
    .addStringOption(o => o.setName('direction').setDescription('Which way?').setRequired(true)
      .addChoices({ name: '📈 Up', value: 'up' }, { name: '📉 Down', value: 'down' }))
    .addNumberOption(o => o.setName('bet').setDescription('Amount to stake').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('horizon').setDescription('Settle after (default 15m)')
      .addChoices({ name: '5 minutes', value: '5m' }, { name: '15 minutes', value: '15m' }, { name: '1 hour', value: '1h' })),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const direction = interaction.options.getString('direction');
    const horizon   = interaction.options.getString('horizon') ?? DEFAULT_HORIZON;

    let ticker, bet;
    try {
      ticker = validateTickerFormat(interaction.options.getString('ticker'));
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    const assetType = detectAssetType(ticker);
    await interaction.deferReply();
    try {
      const { entry, settleAt } = await createPrediction({
        guildId, userId: user.id, channelId: interaction.channelId,
        ticker, assetType, direction, stake: bet, horizon,
      });
      const embed = polish(new EmbedBuilder()
        .setTitle('🔮 Prediction Locked')
        .setColor(BLUE)
        .setDescription(`You staked **${cash(bet)}** that **${ticker}** goes **${direction === 'up' ? '📈 UP' : '📉 DOWN'}**.`)
        .addFields(
          { name: 'Entry price', value: cash(entry),                    inline: true },
          { name: 'Payout',      value: '1.95× on a correct call',      inline: true },
          { name: 'Settles',     value: `<t:${settleAt}:R>`,            inline: true },
        )
        .setFooter({ text: 'Result posts here automatically when it settles.' }), interaction);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err instanceof ValidationError || err instanceof ApiError) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
      throw err;
    }
  },
};
