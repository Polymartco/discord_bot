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

# ── 1. Kill anything holding the apt lock ─────────────────────────────────────
info "Clearing apt locks..."
sudo pkill -9 -f "unattended-upgr|apt-get|dpkg" 2>/dev/null || true
sleep 2
sudo dpkg --configure -a 2>/dev/null || true
ok "apt is free"

# ── 2. Build tools ────────────────────────────────────────────────────────────
info "Installing build tools..."
sudo apt-get update -qq
sudo apt-get install -y build-essential python3 curl ca-certificates
ok "Build tools ready"

# ── 3. Node.js ────────────────────────────────────────────────────────────────
NODE_MAJOR=0
command -v node &>/dev/null && NODE_MAJOR=$(node -e "process.stdout.write(String(process.version.split('.')[0].slice(1)))")

if [[ $NODE_MAJOR -lt 20 ]]; then
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
ok "Node $(node -v)"

# ── 4. .env ───────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] && cp .env.example .env || printf "DISCORD_TOKEN=\nCLIENT_ID=\n" > .env
  die ".env was missing — fill in DISCORD_TOKEN and CLIENT_ID then re-run."
fi
grep -qE "^DISCORD_TOKEN=.+" .env || die "DISCORD_TOKEN is empty in .env"
grep -qE "^CLIENT_ID=.+"    .env || die "CLIENT_ID is empty in .env"
ok ".env looks good"

# ── 5. npm install ────────────────────────────────────────────────────────────
# .npmrc sets build_from_source=true — skips GitHub binary downloads entirely
# and compiles native modules locally. Slower first time, but never hangs.
info "Installing dependencies (compiling native modules — takes ~5 min, do not interrupt)..."
rm -rf node_modules package-lock.json
npm install --omit=optional --no-fund
ok "Dependencies installed"

# ── 6. Register slash commands ────────────────────────────────────────────────
info "Registering slash commands with Discord..."
node src/deploy.js
ok "Slash commands registered"

# ── 7. PM2 ───────────────────────────────────────────────────────────────────
info "Setting up PM2..."
command -v pm2 &>/dev/null || sudo npm install -g pm2
pm2 delete polymart-bot 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save --force
ok "Bot started"

# ── 8. Auto-start on reboot ───────────────────────────────────────────────────
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
