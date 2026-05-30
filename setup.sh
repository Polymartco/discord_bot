#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN} ✓${RESET} $*"; }
info() { echo -e "${CYAN} »${RESET} $*"; }
warn() { echo -e "${YELLOW} !${RESET} $*"; }
die()  { echo -e "\n[FAIL] $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && die "Run as a normal user with sudo, not root."

echo -e "\n${BOLD}── Polymart Bot Setup ──${RESET}\n"

# ── 1. Kill apt lock and install build tools ──────────────────────────────────
info "Clearing apt locks..."
sudo pkill -9 -f "unattended-upgr|apt-get|dpkg" 2>/dev/null || true
sleep 2
sudo dpkg --configure -a 2>/dev/null || true

info "Installing build tools..."
sudo apt-get update -qq
sudo apt-get install -y curl ca-certificates unzip
ok "System packages ready"

# ── 2. Bun ────────────────────────────────────────────────────────────────────
info "Installing Bun..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
ok "Bun $(bun --version)"

# ── 3. .env ───────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] && cp .env.example .env || printf "DISCORD_TOKEN=\nCLIENT_ID=\n" > .env
  die ".env was missing — fill in DISCORD_TOKEN and CLIENT_ID then re-run."
fi
grep -qE "^DISCORD_TOKEN=.+" .env || die "DISCORD_TOKEN is empty in .env"
grep -qE "^CLIENT_ID=.+"    .env || die "CLIENT_ID is empty in .env"
ok ".env looks good"

# ── 4. Install dependencies ───────────────────────────────────────────────────
info "Installing dependencies..."
rm -rf node_modules bun.lockb
bun install --no-optional
ok "Dependencies installed"

# ── 5. Register slash commands ────────────────────────────────────────────────
info "Registering slash commands with Discord..."
bun src/deploy.js
ok "Slash commands registered"

# ── 6. PM2 ───────────────────────────────────────────────────────────────────
info "Setting up PM2..."
command -v pm2 &>/dev/null || npm install -g pm2
mkdir -p logs
pm2 delete polymart-bot 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save --force
ok "Bot started"

# ── 7. Auto-start on reboot ───────────────────────────────────────────────────
info "Configuring systemd auto-start..."
STARTUP=$(pm2 startup systemd 2>&1 | grep -o "sudo env PATH.*" | head -1)
if [[ -n "$STARTUP" ]]; then
  eval "$STARTUP"
  pm2 save --force
  ok "Auto-start enabled"
else
  warn "Run 'pm2 startup systemd' manually and paste the sudo command it gives you."
fi

echo -e "\n${BOLD}${GREEN} ✓ Done — bot is live.${RESET}\n"
echo "  pm2 logs polymart-bot    live logs"
echo "  pm2 restart polymart-bot restart"
echo "  pm2 status               health check"
echo ""
