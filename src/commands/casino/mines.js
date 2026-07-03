import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { cash, GREEN, RED, GOLD, BLUE, errorEmbed, polish } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet, adjust } from '../../casinoLib.js';
import { recordGame, unlockField } from '../../casinoStats.js';

const TILES = 20;            // 5 columns × 4 rows
const HOUSE = 0.97;          // payout edge

export default {
  data: new SlashCommandBuilder()
    .setName('mines')
    .setDescription('Reveal gems and cash out before you hit a mine')
    .setDMPermission(false)
    .addNumberOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('mines').setDescription('Number of mines (1-10, default 3)').setMinValue(1).setMaxValue(10)),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const mineCount = interaction.options.getInteger('mines') ?? 3;

    let bet;
    try {
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    adjust(guildId, user.id, -bet);

    const mines = new Set();
    while (mines.size < mineCount) mines.add(Math.floor(Math.random() * TILES));
    const revealed = new Set();
    let tilesRemaining = TILES, safeRemaining = TILES - mineCount, prob = 1, mult = 1, finished = false;

    const grid = (disabled = false, revealMines = false) => {
      const rows = [];
      for (let r = 0; r < 4; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < 5; c++) {
          const idx    = r * 5 + c;
          const isMine = mines.has(idx);
          const isRev  = revealed.has(idx);
          let label = '❓', style = ButtonStyle.Secondary;
          if (revealMines && isMine) { label = '💣'; style = ButtonStyle.Danger; }
          else if (isRev)            { label = '💎'; style = ButtonStyle.Success; }
          row.addComponents(new ButtonBuilder().setCustomId(`mine_${idx}`).setLabel(label).setStyle(style)
            .setDisabled(disabled || revealMines || isRev));
        }
        rows.push(row);
      }
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('mine_cash').setLabel(`💰 Cash Out (x${mult.toFixed(2)})`)
          .setStyle(ButtonStyle.Primary).setDisabled(disabled || revealed.size === 0)));
      return rows;
    };

    const embed = ({ title, color, footer }) => polish(new EmbedBuilder()
      .setTitle(title ?? '💣 Mines')
      .setColor(color ?? BLUE)
      .addFields(
        { name: 'Bet',         value: cash(bet),                       inline: true },
        { name: 'Mines',       value: String(mineCount),               inline: true },
        { name: 'Gems found',  value: String(revealed.size),           inline: true },
        { name: 'Multiplier',  value: `x${mult.toFixed(2)}`,           inline: true },
        { name: 'Cash-out now', value: cash(Math.round(bet * mult)),   inline: true },
      )
      .setFooter({ text: footer ?? 'Pick a tile, or cash out' }), interaction);

    const msg = await interaction.reply({ embeds: [embed({})], components: grid(), fetchReply: true });
    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    const cashOut = async (apply) => {
      if (finished) return;
      finished = true; collector.stop();
      const winnings = Math.round(bet * mult);
      const bal = adjust(guildId, user.id, winnings);
      const net = winnings - bet;
      const unlocked = recordGame({ guildId, userId: user.id, bet, net, flags: { minesSafe: revealed.size } });
      const e = embed({ title: '💎 Cashed Out!', color: GREEN, footer: `Won ${cash(net)} • Balance ${cash(bal)}` });
      const f = unlockField(unlocked); if (f) e.addFields(f);
      await apply({ embeds: [e], components: grid(true, true) });
    };

    const boom = async (i) => {
      if (finished) return;
      finished = true; collector.stop();
      const bal = ensureUser(guildId, user.id).balance;
      recordGame({ guildId, userId: user.id, bet, net: -bet });
      await i.update({ embeds: [embed({ title: '💥 BOOM — you hit a mine!', color: RED, footer: `Lost ${cash(bet)} • Balance ${cash(bal)}` })], components: grid(true, true) });
    };

    collector.on('collect', async i => {
      if (i.user.id !== user.id) {
        return i.reply({ embeds: [errorEmbed("This isn't your game — start your own with `/mines`.")], ephemeral: true }).catch(() => {});
      }
      if (i.customId === 'mine_cash') return cashOut(p => i.update(p));

      const idx = parseInt(i.customId.slice(5), 10);
      if (revealed.has(idx)) return i.deferUpdate().catch(() => {});
      if (mines.has(idx)) return boom(i);

      prob *= safeRemaining / tilesRemaining;
      tilesRemaining--; safeRemaining--;
      mult = HOUSE / prob;
      revealed.add(idx);

      if (safeRemaining === 0) return cashOut(p => i.update(p)); // cleared the board
      return i.update({ embeds: [embed({})], components: grid() });
    });

    collector.on('end', async (_c, reason) => {
      if (reason === 'time' && !finished) {
        if (revealed.size > 0) await cashOut(p => interaction.editReply(p).catch(() => {}));
        else { adjust(guildId, user.id, bet); recordGame({ guildId, userId: user.id, bet, net: 0 }); await interaction.editReply({ components: grid(true) }).catch(() => {}); }
      }
    });
  },
};
