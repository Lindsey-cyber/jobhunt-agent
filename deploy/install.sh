#!/usr/bin/env bash
# Installs jobhunt-agent on an Ubuntu/Debian VPS as a daily systemd job.
# Run as root from a clone of the repo:  sudo bash deploy/install.sh
# Safe to re-run: it updates code, dependencies and units in place.
set -euo pipefail

APP_USER=jobhunt
APP_DIR=/opt/jobhunt-agent
ENV_FILE=/etc/jobhunt/env
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)

[ "$(id -u)" = 0 ] || { echo "run as root (sudo bash deploy/install.sh)"; exit 1; }

echo "== packages"
apt-get update -qq
# poppler-utils: pdftotext reads the resume for drafted answers.
apt-get install -y -qq git curl ca-certificates poppler-utils >/dev/null
echo "arch $(dpkg --print-architecture)"  # amd64 and arm64 (Hetzner CAX) both work

# Small VPS (4 GB): Chromium plus discovery can spike; a swap file keeps the OOM killer away.
if [ "$(swapon --show --noheadings | wc -l)" = 0 ] && [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 6000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "added 2G swap"
fi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

echo "== user and code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
  cp -a "$SRC_DIR/." "$APP_DIR/"
fi
# The deploy key cloned the repo for root; the service user pushes reports with it too.
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
if [ -f /root/.ssh/jobhunt_deploy ]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/jobhunt_deploy "/home/$APP_USER/.ssh/jobhunt_deploy"
  cat > "/home/$APP_USER/.ssh/config" <<CFG
Host github.com
  IdentityFile ~/.ssh/jobhunt_deploy
  IdentitiesOnly yes
CFG
  chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/config"
  ssh-keyscan -t ed25519 github.com 2>/dev/null > "/home/$APP_USER/.ssh/known_hosts"
  chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/known_hosts"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" git -C "$APP_DIR" config user.name "jobhunt-agent (VPS)"
sudo -u "$APP_USER" git -C "$APP_DIR" config user.email "jobhunt-agent@localhost"

echo "== dependencies and browser"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci --no-audit --no-fund"
(cd "$APP_DIR" && npx --yes playwright install-deps chromium >/dev/null)
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npx playwright install chromium >/dev/null"

echo "== secrets"
install -d -m 750 -o root -g "$APP_USER" /etc/jobhunt
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENV'
# Read by the jobhunt services. Owned by root, readable by the jobhunt group only.
# OpenAI drafts answers to postings' own questions; either key runs the auditor.
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
# anthropic or openai; unset picks whichever key is set, Anthropic first.
JH_AUDIT_PROVIDER=openai
# Optional: model for the triage auditor (default claude-opus-5-5 / gpt-5.5).
# JH_AUDIT_MODEL=claude-opus-5-5
ENV
fi
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.config/jobhunt"

echo "== systemd"
install -m 644 "$APP_DIR/deploy/jobhunt-daily.service" "$APP_DIR/deploy/jobhunt-daily.timer" "$APP_DIR/deploy/jobhunt-dashboard.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jobhunt-daily.timer jobhunt-dashboard.service

echo "== check"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm run -s check" | tail -3
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm run -s jh -- doctor"
systemctl list-timers jobhunt-daily.timer --no-pager | head -3

cat <<NEXT

Installed. Remaining one-time steps (see docs/DEPLOY.md):
  1. Put the OpenAI (and optionally Anthropic) API key in $ENV_FILE
  2. Copy the Gmail OAuth client JSON to /home/$APP_USER/.config/jobhunt/gmail-client.json
     and authorize:  sudo -u $APP_USER bash -c 'cd $APP_DIR && npm run -s jh -- gmail auth'
  3. First run now:  sudo systemctl start jobhunt-daily.service && journalctl -u jobhunt-daily -f
NEXT
