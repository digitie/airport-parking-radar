#!/usr/bin/env bash
set -euo pipefail

if ! hostname -I 2>/dev/null | tr ' ' '\n' | grep -Fxq '192.168.1.14'; then
  echo "Refusing Docker bootstrap: this script is allowed only on 192.168.1.14." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  echo "Docker is already installed."
  exit 0
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

source /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  ${VERSION_CODENAME} stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "${USER}"

echo "Docker installation completed. Re-login may be required for docker group changes."
