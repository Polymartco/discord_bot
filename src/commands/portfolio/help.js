import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed, BLUE } from '../../utils.js';

// Category → ordered command names. Descriptions are pulled live from the loaded
// command collection at runtime, so they never drift from the actual builders.
const CATEGORIES = [
  {
    key: 'market', emoji: '📈', label: 'Market',
    blurb: 'Live prices, charts, market data — and predict where they go.',
    commands: ['market', 'overview', 'top', 'stock', 'stocks', 'crypto', 'cryptomarket',
               'forex', 'sector', 'heatmap', 'leaderboard', 'screener', 'compare',
               'search', 'info', 'news', 'macro', 'predict'],
  },
  {
    key: 'portfolio', emoji: '💼', label: 'Portfolio',
    blurb: 'Trade, track positions, and level up your account.',
    commands: ['balance', 'portfolio', 'buy', 'sell', 'profit', 'history', 'stats',
               'watchlist', 'alert', 'pending', 'daily', 'streakfreeze', 'remindme',
               'level', 'achievements', 'profile', 'link', 'unlink'],
  },
  {
    key: 'casino', emoji: '🎰', label: 'Casino',
    blurb: 'Games of chance, duels, quests, and free crates.',
    commands: ['blackjack', 'roulette', 'slots', 'mines', 'coinflip', 'challenge',
               'quests', 'crate', 'work', 'beg', 'casinostats', 'casinotop'],
  },
  {
    key: 'admin', emoji: '🛠️', label: 'Admin',
    blurb: 'Server configuration. Requires the Manage Server permission.',
    commands: ['setup', 'config', 'setchannel', 'give', 'take', 'resetuser',
               'season', 'announce', 'happyhour'],
  },
];

/** Look up a command's live description from the client collection. */
function describe(client, name) {
  return client.commands.get(name)?.data?.description ?? '';
}

/** Build the field list for a single category (skips commands that didn't load). */
function categoryLines(client, cat) {
  return cat.commands
    .filter(name => client.commands.has(name))
    .map(name => `\`/${name}\` — ${describe(client, name)}`)
    .join('\n');
}

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List every command, or drill into one category')
    .addStringOption(o =>
      o.setName('category')
        .setDescription('Show only commands in this category')
        .addChoices(...CATEGORIES.map(c => ({ name: `${c.emoji} ${c.label}`, value: c.key })))),

  async execute(interaction) {
    const { client } = interaction;
    const pick = interaction.options.getString('category');

    if (pick) {
      const cat = CATEGORIES.find(c => c.key === pick);
      const embed = brandEmbed({
        title: `${cat.emoji} ${cat.label} Commands`,
        color: BLUE,
        interaction,
      })
        .setDescription(`${cat.blurb}\n\n${categoryLines(client, cat) || '_No commands available._'}`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = brandEmbed({ title: '📖 Polymart — Command Guide', color: BLUE, interaction })
      .setDescription(
        `Here's everything I can do. Use \`/help category:<name>\` for the full list in a section.\n` +
        `New here? An admin should run \`/setup\` first, then grab your starting cash with \`/daily\`.`,
      );

    for (const cat of CATEGORIES) {
      const names = cat.commands.filter(n => client.commands.has(n));
      if (!names.length) continue;
      embed.addFields({
        name: `${cat.emoji} ${cat.label} · ${names.length}`,
        value: `${cat.blurb}\n${names.map(n => `\`/${n}\``).join('  ')}`,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
