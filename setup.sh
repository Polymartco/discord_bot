#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

TOTAL_STEPS=8
STEP_NUM=0

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''
fi

ok()   { echo "  ${C_GREEN}✔${C_RESET}  $*"; }
info() { echo "  ${C_CYAN}…${C_RESET}  $*"; }
warn() { echo "  ${C_YELLOW}⚠${C_RESET}  $*"; }
die()  { echo; echo "  ${C_RED}✖  $*${C_RESET}" >&2; exit 1; }
step() { STEP_NUM=$((STEP_NUM + 1)); echo; echo "${C_BOLD}${C_CYAN}--- [$STEP_NUM/$TOTAL_STEPS] $* ---${C_RESET}"; }

[[ $EUID -eq 0 ]] && die "Run as a normal user with sudo, not root."

echo
echo "${C_BOLD}=================================${C_RESET}"
echo "${C_BOLD}     Polymart Bot  -  Setup      ${C_RESET}"
echo "${C_BOLD}=================================${C_RESET}"

# ── 1. Clear apt locks ────────────────────────────────────────────────────────
step "Clearing apt locks"
sudo pkill -9 -f "unattended-upgr|apt-get|dpkg" 2>/dev/null || true
sleep 2
sudo dpkg --configure -a 2>/dev/null || true
ok "apt is free"

# ── 2. System packages ────────────────────────────────────────────────────────
step "System packages"
sudo apt-get update -qq
sudo apt-get install -y curl ca-certificates unzip
ok "curl, ca-certificates, unzip ready"

# ── 3. Bun ────────────────────────────────────────────────────────────────────
step "Installing Bun"
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
ok "Bun $(bun --version) installed"

# ── 4. Check .env ─────────────────────────────────────────────────────────────
step "Environment"
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] && cp .env.example .env || printf "DISCORD_TOKEN=\nCLIENT_ID=\n" > .env
  die ".env was missing - fill in DISCORD_TOKEN and CLIENT_ID then re-run."
fi
grep -qE "^DISCORD_TOKEN=.+" .env || die "DISCORD_TOKEN is empty in .env"
grep -qE "^CLIENT_ID=.+"    .env || die "CLIENT_ID is empty in .env"
ok ".env looks good"

# ── 5. Install dependencies ───────────────────────────────────────────────────
step "Installing dependencies"
rm -rf node_modules bun.lockb
bun install
ok "Dependencies installed"

# ── 6. Register slash commands ────────────────────────────────────────────────
step "Registering slash commands"
bun src/deploy.js
ok "Slash commands registered"

# ── 7. PM2 ───────────────────────────────────────────────────────────────────
step "Starting bot with PM2"
command -v pm2 &>/dev/null || bun install -g pm2
mkdir -p logs
pm2 delete polymart-bot 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save --force
ok "Bot is running"

# ── 8. Auto-start on reboot ───────────────────────────────────────────────────
step "Systemd auto-start"
STARTUP=$(pm2 startup systemd 2>&1 | grep -o "sudo env PATH.*" | head -1 || true)
if [[ -n "$STARTUP" ]]; then
  info "Running: $STARTUP"
  eval "$STARTUP"
  pm2 save --force
  ok "Auto-start configured"
else
  warn "Could not auto-configure. Run 'pm2 startup systemd' manually."
fi

echo
echo "${C_GREEN}${C_BOLD}=================================${C_RESET}"
echo "${C_GREEN}${C_BOLD}      ✔ Done - bot is live${C_RESET}"
echo "${C_GREEN}${C_BOLD}=================================${C_RESET}"
echo
echo "  pm2 logs polymart-bot    - live logs"
echo "  pm2 restart polymart-bot - restart"
echo "  pm2 status               - health check"
echo
