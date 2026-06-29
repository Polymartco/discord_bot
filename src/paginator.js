import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { registerComponent, buildId } from './interactionRouter.js';
import { errorEmbed } from './utils.js';

// ── Reusable, restart-proof paginator ─────────────────────────────────────────
// A command registers a "page source" that can rebuild any page purely from
// encoded args, so Prev/Next keep working after a restart (no in-memory state).
//
//   source(interaction, { args, page }) => { embeds, files?, totalPages }
//
// customId layout (via the 'page' namespace):
//   page : <key> : <owner> : ...sourceArgs : <dir> : <currentPage>

const sources = new Map(); // key → source fn

export function registerPageSource(key, fn) {
  sources.set(key, fn);
}

function navRow(key, ownerId, sourceArgs, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('page', key, ownerId, ...sourceArgs, 'prev', String(page)))
      .setLabel('◀  Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(buildId('page', 'noop', ownerId))
      .setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder()
      .setCustomId(buildId('page', key, ownerId, ...sourceArgs, 'next', String(page)))
      .setLabel('Next  ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  );
}

/** Render the first page and attach nav buttons (only when there's >1 page). */
export async function startPaginator(interaction, { key, sourceArgs = [], owner }) {
  const source = sources.get(key);
  if (!source) throw new Error(`No page source registered for "${key}"`);

  const { embeds, files = [], totalPages } = await source(interaction, { args: sourceArgs, page: 0 });
  const components = totalPages > 1 ? [navRow(key, owner, sourceArgs, 0, totalPages)] : [];
  return interaction.editReply({ embeds, files, components });
}

// ── Component handler for the 'page' namespace ────────────────────────────────
registerComponent('page', async (interaction, { action, ownerId, args }) => {
  const source = sources.get(action);
  if (!source) {
    return interaction.reply({ embeds: [errorEmbed('These page controls have expired.')], ephemeral: true }).catch(() => {});
  }

  const pageStr    = args[args.length - 1];
  const dir        = args[args.length - 2];
  const sourceArgs = args.slice(0, -2);
  let page = (parseInt(pageStr, 10) || 0) + (dir === 'next' ? 1 : -1);
  if (page < 0) page = 0;

  let result;
  try {
    result = await source(interaction, { args: sourceArgs, page });
  } catch (err) {
    console.warn('[Paginator] page source failed:', err.message);
    return interaction.reply({ embeds: [errorEmbed('Could not load that page.')], ephemeral: true }).catch(() => {});
  }

  const { embeds, files = [], totalPages } = result;
  page = Math.min(page, totalPages - 1);
  await interaction.update({
    embeds,
    files,
    components: totalPages > 1 ? [navRow(action, ownerId, sourceArgs, page, totalPages)] : [],
  }).catch(() => {});
});
