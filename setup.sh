#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Polymart Bot — one-click setup + PM2 deployment
#  Run with:  bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error()   { echo -e "${RED}[error]${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──${RESET}"; }

# ── Detect platform ───────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux*)  PLATFORM=linux  ;;
  Darwin*) PLATFORM=mac    ;;
  CYGWIN*|MINGW*|MSYS*) PLATFORM=windows ;;
  *) PLATFORM=unknown ;;
esac

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║      Polymart Bot  •  Setup       ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${RESET}"

# ── 1. Node.js version check ──────────────────────────────────────────────────
header "Checking requirements"

command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install v20+ from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm is not installed."

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)

if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "Node.js v20+ required. You have v${NODE_VER}. Update at https://nodejs.org"
fi
success "Node.js v${NODE_VER}"

# ── 2. .env check ─────────────────────────────────────────────────────────────
header "Environment file"

if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    cp .env.example .env
    warn ".env created from .env.example"
  else
    printf "DISCORD_TOKEN=your_bot_token_here\nCLIENT_ID=your_application_id_here\n" > .env
    warn ".env created from scratch"
  fi
  echo ""
  echo -e "  ${YELLOW}Open ${BOLD}.env${RESET}${YELLOW} and fill in:${RESET}"
  echo "    DISCORD_TOKEN  — Bot token from https://discord.com/developers/applications"
  echo "    CLIENT_ID      — Application ID (same page, General Information)"
  echo ""
  read -rp "  Press Enter once you've saved .env, or Ctrl+C to abort... "
fi

# Validate that the values have been changed from the placeholder
if grep -qE "^(DISCORD_TOKEN|CLIENT_ID)=your_" .env 2>/dev/null; then
  die ".env still contains placeholder values. Edit it before running setup."
fi

# Check required keys are present and non-empty
for KEY in DISCORD_TOKEN CLIENT_ID; do
  VAL=$(grep -E "^${KEY}=" .env | cut -d= -f2- | tr -d '[:space:]')
  if [[ -z "$VAL" ]]; then
    die "${KEY} is missing or empty in .env"
  fi
done
success ".env looks good"

# ── 3. Install dependencies ───────────────────────────────────────────────────
header "Installing dependencies"
npm install --no-fund --no-audit
success "npm install complete"

# ── 4. Create logs directory ──────────────────────────────────────────────────
mkdir -p logs
success "logs/ directory ready"

# ── 5. Deploy slash commands ──────────────────────────────────────────────────
header "Registering slash commands with Discord"
info "This contacts the Discord API — may take a few seconds..."
node src/deploy.js
success "Slash commands registered"

# ── 6. Install / verify PM2 ───────────────────────────────────────────────────
header "Setting up PM2"

if ! command -v pm2 >/dev/null 2>&1; then
  info "PM2 not found — installing globally..."
  npm install -g pm2
  success "PM2 installed"
else
  PM2_VER=$(pm2 --version 2>/dev/null || echo "?")
  success "PM2 v${PM2_VER} already installed"
fi

# ── 7. Start the bot under PM2 ───────────────────────────────────────────────
header "Starting bot with PM2"

# Stop existing instance gracefully before (re)starting
pm2 delete polymart-bot 2>/dev/null || true

pm2 start ecosystem.config.cjs
pm2 save --force
success "Bot started as 'polymart-bot'"

# ── 8. Auto-start on boot ────────────────────────────────────────────────────
header "Configuring auto-start on boot"

if [[ "$PLATFORM" == "windows" ]]; then
  if ! npm list -g pm2-windows-startup >/dev/null 2>&1; then
    info "Installing pm2-windows-startup..."
    npm install -g pm2-windows-startup
  fi
  pm2-windows-startup install 2>/dev/null && success "Windows auto-start configured" \
    || warn "Could not configure Windows auto-start automatically. Run: pm2-windows-startup install"

elif [[ "$PLATFORM" == "linux" || "$PLATFORM" == "mac" ]]; then
  STARTUP_CMD=$(pm2 startup 2>&1 | grep -E "sudo env|sudo pm2" | head -1)
  if [[ -n "$STARTUP_CMD" ]]; then
    echo ""
    echo -e "  ${YELLOW}Run this command to enable auto-start on boot:${RESET}"
    echo -e "  ${BOLD}${STARTUP_CMD}${RESET}"
    echo ""
    read -rp "  Run it now? [y/N] " RUN_IT
    if [[ "${RUN_IT,,}" == "y" ]]; then
      eval "$STARTUP_CMD" && success "Auto-start enabled" || warn "Could not run automatically — copy and run the command above as root."
    else
      warn "Skipped. Run the command above manually when ready."
    fi
    pm2 save --force
  else
    warn "Could not determine startup command. Run 'pm2 startup' manually."
  fi
else
  warn "Unknown platform — run 'pm2 startup' manually to enable auto-start."
fi

# ── 9. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ✓ Setup complete!${RESET}"
echo ""
echo "  Useful PM2 commands:"
echo "    pm2 logs polymart-bot     — live log tail"
echo "    pm2 status                — see process status"
echo "    pm2 restart polymart-bot  — restart the bot"
echo "    pm2 stop polymart-bot     — stop the bot"
echo "    pm2 delete polymart-bot   — remove from PM2"
echo ""
