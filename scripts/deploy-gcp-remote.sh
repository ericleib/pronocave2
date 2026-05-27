#!/usr/bin/env bash
set -euo pipefail

archive="${1:-/tmp/pronocave-release.tgz}"
release="${2:-$(date +%Y%m%d%H%M%S)}"
release_dir="/opt/pronocave/releases/${release}"

if [ ! -f "$archive" ]; then
  echo "Release archive not found: $archive" >&2
  exit 1
fi

sudo useradd --system --home /opt/pronocave --shell /usr/sbin/nologin pronocave 2>/dev/null || true
sudo mkdir -p "$release_dir" /var/lib/pronocave/uploads /etc/pronocave
sudo tar -xzf "$archive" -C "$release_dir"
sudo rm -rf "$release_dir/public/uploads"
sudo ln -s /var/lib/pronocave/uploads "$release_dir/public/uploads"
sudo chown -R pronocave:pronocave "$release_dir" /var/lib/pronocave

if [ ! -f /etc/pronocave/pronocave.env ]; then
  echo "/etc/pronocave/pronocave.env is missing." >&2
  echo "Create it first with NODE_ENV, PORT, DATABASE_URL, SESSION_SECRET, and ADMIN_PASSWORD." >&2
  exit 1
fi

cd "$release_dir"
sudo -u pronocave npm ci --omit=dev
sudo -u pronocave npm test

sudo ln -sfn "$release_dir" /opt/pronocave/current
sudo tee /etc/systemd/system/pronocave.service >/dev/null <<'EOF'
[Unit]
Description=Pronocave
After=network.target

[Service]
Type=simple
User=pronocave
Group=pronocave
WorkingDirectory=/opt/pronocave/current
EnvironmentFile=/etc/pronocave/pronocave.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable pronocave
sudo systemctl restart pronocave
sleep 2
sudo systemctl status pronocave --no-pager
echo "deployed-release=${release}"
