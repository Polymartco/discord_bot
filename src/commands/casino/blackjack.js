import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, GREEN, RED, GOLD, BLUE, errorEmbed, polish } from '../../utils.js';
import { ValidationError } from '../../validate.js';
import { ensureUser, validateBet, adjust, makeDeck, handValue, handStr, isBlackjack } from '../../casinoLib.js';
import { recordGame, unlockField } from '../../casinoStats.js';

const TEN = new Set(['10', 'J', 'Q', 'K']);
const splittable = (a, b) => a.r === b.r || (TEN.has(a.r) && TEN.has(b.r));

export default {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play blackjack — with Double Down and Split')
    .setDMPermission(false)
    .addNumberOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const { guildId, user } = interaction;

    let bet;
    try {
      const dbUser = ensureUser(guildId, user.id);
      bet = validateBet(interaction.options.getNumber('bet'), dbUser.balance);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
      throw err;
    }

    adjust(guildId, user.id, -bet); // escrow

    const getBal = () => stmt.getUser.get(guildId, user.id).balance;
    const deck   = makeDeck();
    const dealer = [deck.pop(), deck.pop()];
    let hands    = [{ cards: [deck.pop(), deck.pop()], bet, done: false, busted: false }];
    let activeIndex = 0;
    let splitUsed   = false;
    let finished    = false;

    const totalBet = () => hands.reduce((s, h) => s + h.bet, 0);

    const render = ({ hideHole, title, color, footer }) => {
      const e = new EmbedBuilder().setTitle(title ?? '🃏 Blackjack').setColor(color ?? BLUE);
      hands.forEach((h, idx) => {
        const marker = (!finished && idx === activeIndex && hands.length > 1) ? '▶ ' : '';
        const tag    = h.busted ? ' 💥' : '';
        const label  = hands.length > 1 ? `${marker}Hand ${idx + 1} (${handValue(h.cards)})${tag}` : `Your hand (${handValue(h.cards)})${tag}`;
        e.addFields({ name: label, value: handStr(h.cards) || '—', inline: false });
      });
      const dealerCards = hideHole ? `${handStr([dealer[0]])}  🂠` : handStr(dealer);
      const dealerVal   = hideHole ? `${handValue([dealer[0]])}+` : handValue(dealer);
      e.addFields({ name: `Dealer (${dealerVal})`, value: dealerCards || '—', inline: false });
      e.setFooter({ text: footer ?? `Bet: ${cash(totalBet())} • Your move` });
      return polish(e, interaction);
    };

    const buttons = (disabled = false) => {
      const h   = hands[activeIndex];
      const bal = getBal();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      );
      if (!disabled && h && h.cards.length === 2 && bal >= h.bet) {
        row.addComponents(new ButtonBuilder().setCustomId('bj_double').setLabel('Double').setStyle(ButtonStyle.Success));
      }
      if (!disabled && !splitUsed && hands.length === 1 && h && h.cards.length === 2 && splittable(h.cards[0], h.cards[1]) && bal >= h.bet) {
        row.addComponents(new ButtonBuilder().setCustomId('bj_split').setLabel('Split').setStyle(ButtonStyle.Danger));
      }
      return row;
    };

    // ── Natural blackjack (single hand only) ──────────────────────────────────
    if (isBlackjack(hands[0].cards)) {
      if (isBlackjack(dealer)) {
        const bal = adjust(guildId, user.id, bet); // push
        recordGame({ guildId, userId: user.id, bet, net: 0 });
        return interaction.reply({ embeds: [render({ hideHole: false, title: '🃏 Push — both blackjack', color: GOLD, footer: `Bet returned • Balance ${cash(bal)}` })] });
      }
      const winnings = Math.round(bet * 2.5);
      const bal = adjust(guildId, user.id, winnings);
      const unlocked = recordGame({ guildId, userId: user.id, bet, net: winnings - bet, flags: { blackjackNatural: true } });
      const embed = render({ hideHole: false, title: '🃏 Blackjack! Pays 3:2', color: GREEN, footer: `Won ${cash(winnings - bet)} • Balance ${cash(bal)}` });
      const f = unlockField(unlocked); if (f) embed.addFields(f);
      return interaction.reply({ embeds: [embed] });
    }

    const msg = await interaction.reply({ embeds: [render({ hideHole: true })], components: [buttons()], fetchReply: true });
    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    const advance = () => {
      while (activeIndex < hands.length && hands[activeIndex].done) activeIndex++;
      return activeIndex >= hands.length;
    };

    const endGame = async (apply) => {
      if (finished) return;
      finished = true;
      collector.stop();

      if (hands.some(h => !h.busted)) while (handValue(dealer) < 17) dealer.push(deck.pop());
      const dv = handValue(dealer);

      let credit = 0;
      for (const h of hands) {
        const pv = handValue(h.cards);
        if (h.busted || (pv < dv && dv <= 21)) continue;        // loss → nothing
        if (dv > 21 || pv > dv) credit += h.bet * 2;            // win
        else if (pv === dv)     credit += h.bet;                // push
      }

      const stake = totalBet();
      const bal   = credit > 0 ? adjust(guildId, user.id, credit) : getBal();
      const net   = credit - stake;
      const unlocked = recordGame({ guildId, userId: user.id, bet: stake, net });

      const title  = net > 0 ? '🃏 Blackjack — You win!' : net < 0 ? '🃏 Blackjack — You lose' : '🃏 Blackjack — Push';
      const color  = net > 0 ? GREEN : net < 0 ? RED : GOLD;
      const footer = net > 0 ? `Won ${cash(net)} • Balance ${cash(bal)}`
                   : net < 0 ? `Lost ${cash(-net)} • Balance ${cash(bal)}`
                   :           `Bet returned • Balance ${cash(bal)}`;
      const embed  = render({ hideHole: false, title, color, footer });
      const f = unlockField(unlocked); if (f) embed.addFields(f);
      await apply({ embeds: [embed], components: [buttons(true)] });
    };

    collector.on('collect', async i => {
      if (i.user.id !== user.id) {
        return i.reply({ embeds: [errorEmbed("This isn't your table — start your own with `/blackjack`.")], ephemeral: true }).catch(() => {});
      }
      const h = hands[activeIndex];

      if (i.customId === 'bj_hit') {
        h.cards.push(deck.pop());
        if (handValue(h.cards) > 21) { h.busted = true; h.done = true; if (advance()) return endGame(p => i.update(p)); }
        return i.update({ embeds: [render({ hideHole: true })], components: [buttons()] });
      }
      if (i.customId === 'bj_stand') {
        h.done = true;
        if (advance()) return endGame(p => i.update(p));
        return i.update({ embeds: [render({ hideHole: true })], components: [buttons()] });
      }
      if (i.customId === 'bj_double') {
        if (h.cards.length !== 2 || getBal() < h.bet) return i.deferUpdate().catch(() => {});
        adjust(guildId, user.id, -h.bet);
        h.bet *= 2;
        h.cards.push(deck.pop());
        h.done = true;
        if (handValue(h.cards) > 21) h.busted = true;
        if (advance()) return endGame(p => i.update(p));
        return i.update({ embeds: [render({ hideHole: true })], components: [buttons()] });
      }
      if (i.customId === 'bj_split') {
        if (splitUsed || hands.length !== 1 || !splittable(h.cards[0], h.cards[1]) || getBal() < h.bet) return i.deferUpdate().catch(() => {});
        adjust(guildId, user.id, -h.bet);
        hands = [
          { cards: [h.cards[0], deck.pop()], bet: h.bet, done: false, busted: false },
          { cards: [h.cards[1], deck.pop()], bet: h.bet, done: false, busted: false },
        ];
        splitUsed = true; activeIndex = 0;
        return i.update({ embeds: [render({ hideHole: true })], components: [buttons()] });
      }
    });

    collector.on('end', async (_c, reason) => {
      if (reason === 'time' && !finished) {
        hands.forEach(h => { h.done = true; });
        await endGame(p => interaction.editReply(p).catch(() => {}));
      }
    });
  },
};
