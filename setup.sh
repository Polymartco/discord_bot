#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Polymart Bot — one-click setup for Debian / Ubuntu (Google Cloud)
#  Run with:  bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Tell apt/dpkg never to open interactive prompts
export DEBIAN_FRONTEND=noninteractive

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ ok ]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
die()     { echo -e "${RED}[fail]${RESET}  $*" >&2; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}━━  $*  ━━${RESET}"; }

echo -e "${BOLD}"
echo "  ╔════════════════════════════════════╗"
echo "  ║   Polymart Bot  •  Debian Setup    ║"
echo "  ╚════════════════════════════════════╝"
echo -e "${RESET}"

[[ "$EUID" -eq 0 ]] && die "Don't run as root. Use a regular user with sudo access."

# ── 1. System packages ────────────────────────────────────────────────────────
header "System packages"

info "Waiting for apt lock and updating package lists..."
sudo apt-get update

info "Installing build tools..."
sudo apt-get install -y \
  build-essential \
  python3 \
  curl \
  ca-certificates \
  gnupg

success "System packages ready"

# ── 2. Node.js ────────────────────────────────────────────────────────────────
header "Node.js"

needs_node=false
if ! command -v node >/dev/null 2>&1; then
  needs_node=true
else
  NODE_MAJOR=$(node -e "process.stdout.write(String(process.version.split('.')[0].slice(1)))")
  [[ "$NODE_MAJOR" -lt 20 ]] && needs_node=true && warn "Node.js v${NODE_MAJOR} is too old — upgrading to v22"
fi

if [[ "$needs_node" == true ]]; then
  info "Installing Node.js 22 LTS via NodeSource..."
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    | sudo tee /etc/apt/sources.list.d/nodesource.list
  info "Updating apt with NodeSource repo..."
  sudo apt-get update
  info "Installing nodejs package..."
  sudo apt-get install -y nodejs
fi

success "Node.js $(node -v)"
success "npm     v$(npm -v)"

# ── 3. .env ───────────────────────────────────────────────────────────────────
header "Environment file"

if [[ ! -f ".env" ]]; then
  [[ -f ".env.example" ]] && cp .env.example .env \
    || printf "DISCORD_TOKEN=your_bot_token_here\nCLIENT_ID=your_application_id_here\n" > .env
  warn ".env created — fill in your credentials before continuing."
fi

if grep -qE "^(DISCORD_TOKEN|CLIENT_ID)=your_" .env 2>/dev/null; then
  echo ""
  echo -e "  ${YELLOW}Edit .env with your credentials, then re-run this script:${RESET}"
  echo "    DISCORD_TOKEN  — https://discord.com/developers/applications → Bot → Token"
  echo "    CLIENT_ID      — General Information → Application ID"
  echo ""
  echo -e "  ${BOLD}nano .env${RESET}"
  exit 1
fi

for KEY in DISCORD_TOKEN CLIENT_ID; do
  VAL=$(grep -E "^${KEY}=" .env | cut -d= -f2- | tr -d '[:space:]')
  [[ -z "$VAL" ]] && die "${KEY} is missing or empty in .env"
done
success ".env looks good"

# ── 4. npm install ────────────────────────────────────────────────────────────
header "Installing npm dependencies"
info "This may take a minute on first run (native modules compile from source)..."
npm install --no-fund --no-audit
info "Rebuilding native modules for this platform..."
npm rebuild better-sqlite3
success "npm install complete"

# ── 5. Logs directory ─────────────────────────────────────────────────────────
mkdir -p logs
success "logs/ directory ready"

# ── 6. Register slash commands ────────────────────────────────────────────────
header "Registering slash commands"
info "Contacting Discord API..."
node src/deploy.js
success "Slash commands registered"

# ── 7. PM2 ───────────────────────────────────────────────────────────────────
header "PM2 process manager"

if ! command -v pm2 >/dev/null 2>&1; then
  info "Installing PM2 globally..."
  sudo npm install -g pm2
fi
success "PM2 $(pm2 --version)"

# ── 8. Start bot ─────────────────────────────────────────────────────────────
header "Starting bot"

pm2 delete polymart-bot 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save --force
success "Bot started as 'polymart-bot'"

# ── 9. Systemd auto-start ────────────────────────────────────────────────────
header "Auto-start on reboot"

info "Generating systemd startup script..."

# Run pm2 startup, capture its output, extract the sudo command it tells us to run
STARTUP_OUTPUT=$(pm2 startup systemd 2>&1 || true)
STARTUP_CMD=$(echo "$STARTUP_OUTPUT" | grep -oP "sudo env PATH=\S+ \S+ startup systemd[^\n]*" | head -1)

if [[ -n "$STARTUP_CMD" ]]; then
  info "Running: $STARTUP_CMD"
  eval "$STARTUP_CMD"
  pm2 save --force
  success "Systemd unit created — bot will restart after reboots"
else
  warn "Could not auto-detect the pm2 startup command."
  warn "Run manually:  pm2 startup systemd  then copy-paste the sudo command it gives you."
  echo ""
  echo "Full pm2 startup output was:"
  echo "$STARTUP_OUTPUT"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}  ✓ Bot is live.${RESET}"
echo ""
echo "  pm2 logs polymart-bot     — tail logs"
echo "  pm2 status                — process health"
echo "  pm2 restart polymart-bot  — restart"
echo "  pm2 stop polymart-bot     — stop"
echo ""
