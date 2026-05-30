import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { drawPriceChart } from './chart.js';

export const GREEN = 0x22c55e;
export const RED   = 0xef4444;
export const BLUE  = 0x6366f1;
export const GOLD  = 0xf59e0b;

export const sign     = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
export const cash     = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const priceFmt = (n, decimals = 4) => n < 1 ? n.toFixed(5) : n < 100 ? n.toFixed(decimals) : n.toFixed(2);
export const colorOf  = n => n >= 0 ? GREEN : RED;

export function chartAttachment(history, label, currentPrice, changePct) {
  const buf = drawPriceChart({ history, label, currentPrice, changePct });
  return new AttachmentBuilder(buf, { name: 'chart.png' });
}

export function errorEmbed(message) {
  return new EmbedBuilder().setColor(RED).setDescription(`❌ ${message}`);
}

export function successEmbed(message) {
  return new EmbedBuilder().setColor(GREEN).setDescription(`✅ ${message}`);
}

export function requireSetup(config, interaction) {
  if (!config.setup_by) {
    interaction.reply({ embeds: [errorEmbed('This server has not been set up yet. An admin must run `/setup` first.')], ephemeral: true });
    return false;
  }
  return true;
}
