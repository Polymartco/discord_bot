import 'dotenv/config';
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startAlertPoller } from './alertPoller.js';
import db from './db.js';

// ── Environment validation ────────────────────────────────────────────────────
if (!process.env.DISCORD_TOKEN) {
  console.error('[Startup] DISCORD_TOKEN is not set in .env — cannot start.');
  process.exit(1);
}
if (!process.env.CLIENT_ID) {
  console.error('[Startup] CLIENT_ID is not set in .env — cannot deploy commands.');
  // Not fatal for running the bot, but warn loudly
}

// ── Global error safety net ───────────────────────────────────────────────────
// Prevents single async failures from crashing the entire process.
process.on('uncaughtException', err => {
  console.error('[Process] uncaughtException — bot will continue:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] unhandledRejection at:', promise, 'reason:', reason);
});

// ── Client setup ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandFolders = ['market', 'portfolio', 'admin'];
for (const folder of commandFolders) {
  const files = readdirSync(join(__dirname, 'commands', folder)).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const cmd = await import(`./commands/${folder}/${file}`);
    if (!cmd.default?.data?.name) {
      console.warn(`[Startup] Skipping ${folder}/${file} — missing data.name`);
      continue;
    }
    client.commands.set(cmd.default.data.name, cmd.default);
  }
}

console.log(`[Startup] Loaded ${client.commands.size} commands.`);

// ── Discord event handlers ────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  startAlertPoller(client);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`[Cmd] /${interaction.commandName} threw:`, err);
    const msg = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    } catch {
      // Interaction may have expired — nothing we can do
    }
  }
});

client.on('warn',  msg  => console.warn('[Discord.js warn]',  msg));
client.on('error', err  => console.error('[Discord.js error]', err));

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[Process] Received ${signal} — shutting down gracefully.`);
  client.destroy();
  try { db.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Connect ───────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
