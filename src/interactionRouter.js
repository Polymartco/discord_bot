import { errorEmbed } from './utils.js';
import { assertCommandCooldown, ValidationError } from './validate.js';

// ── Global interaction router ─────────────────────────────────────────────────
// Single entry point for every interaction type:
//   • chat-input commands  → command.execute (behind a light per-user throttle)
//   • autocomplete         → command.autocomplete
//   • buttons / selects    → a namespaced component handler, after an ownership check
//
// Component state lives entirely in the customId (no in-memory collectors), so
// controls keep working after a bot restart. customId format:
//
//     namespace : action : ownerId : arg1 : arg2 ...
//
// ownerId is the Discord user allowed to use the control ('*' = anyone).

const SEP = ':';
const GLOBAL_COOLDOWN_MS = 750; // anti-spam guard applied to ALL slash commands

const componentHandlers = new Map(); // namespace → async (interaction, ctx) => void

/** Register a handler for a component namespace (e.g. 'trade', 'view', 'page'). */
export function registerComponent(namespace, handler) {
  componentHandlers.set(namespace, handler);
}

/** Encode a component customId. Keep the result ≤ 100 chars (Discord limit). */
export function buildId(namespace, action, ownerId = '*', ...args) {
  return [namespace, action, ownerId, ...args].join(SEP);
}

/** Decode a component customId into its parts. */
export function parseId(customId) {
  const [namespace, action, ownerId, ...args] = customId.split(SEP);
  return { namespace, action, ownerId, args };
}

// ── Main dispatch ─────────────────────────────────────────────────────────────
export async function handleInteraction(interaction, client) {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction, client);
    if (interaction.isAutocomplete())     return await handleAutocomplete(interaction, client);
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      return await handleComponent(interaction);
    }
  } catch (err) {
    console.error('[Router] Unhandled interaction error:', err);
    await safeError(interaction);
  }
}

// ── Slash commands ────────────────────────────────────────────────────────────
async function handleCommand(interaction, client) {
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  // Light global throttle — stops display-command spam from burning API budget.
  // (buy/sell layer a stricter 'trade' cooldown on top of this.)
  try {
    assertCommandCooldown(interaction.user.id, 'cmd', GLOBAL_COOLDOWN_MS);
  } catch (err) {
    if (err instanceof ValidationError) {
      return interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true }).catch(() => {});
    }
    throw err;
  }

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`[Cmd] /${interaction.commandName} threw:`, err);
    await safeError(interaction);
  }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
async function handleAutocomplete(interaction, client) {
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd?.autocomplete) return interaction.respond([]).catch(() => {});
  try {
    await cmd.autocomplete(interaction);
  } catch (err) {
    console.warn(`[Autocomplete] /${interaction.commandName} failed:`, err.message);
    interaction.respond([]).catch(() => {});
  }
}

// ── Buttons & select menus ────────────────────────────────────────────────────
async function handleComponent(interaction) {
  const { namespace, action, ownerId, args } = parseId(interaction.customId);

  // Not a router-managed component (e.g. a command's own collector buttons like
  // blackjack/mines). Ignore it so the collector can handle it without interference.
  const handler = componentHandlers.get(namespace);
  if (!handler) return;

  // Ownership: only the user who invoked the original command may drive its controls.
  if (ownerId && ownerId !== '*' && ownerId !== interaction.user.id) {
    return interaction.reply({
      embeds:    [errorEmbed("These controls aren't yours — run the command yourself.")],
      ephemeral: true,
    }).catch(() => {});
  }

  await handler(interaction, { action, ownerId, args });
}

// ── Shared error reply ────────────────────────────────────────────────────────
async function safeError(interaction) {
  const payload = { embeds: [errorEmbed('Something went wrong. Please try again.')], ephemeral: true };
  try {
    if (interaction.isAutocomplete?.()) return; // can't reply to autocomplete with an embed
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {
    // Interaction may have expired — nothing more we can do.
  }
}
