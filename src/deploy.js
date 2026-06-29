import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const commands  = [];
const folders   = ['market', 'portfolio', 'admin', 'casino'];

for (const folder of folders) {
  const files = readdirSync(join(__dirname, 'commands', folder)).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const cmd = await import(`./commands/${folder}/${f}`);
    commands.push(cmd.default.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
console.log(`Registered ${commands.length} commands.`);
