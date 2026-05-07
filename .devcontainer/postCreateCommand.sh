#!/usr/bin/env bash
# Codespace bootstrap — runs once when the container is created.
# Installs Solana CLI + Anchor + Circom so `scripts/deploy-all.sh` can run.

set -euo pipefail

echo "▸ Installing Solana CLI v1.18.22"
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)" || true

# Persist PATH for future shells
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "▸ Installing Anchor v0.30.1 (via avm)"
if ! command -v avm &> /dev/null; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
fi
avm install 0.30.1
avm use 0.30.1

echo "▸ Installing Circom v2.1.9 (precompiled)"
if ! command -v circom &> /dev/null; then
  curl -L -o /tmp/circom https://github.com/iden3/circom/releases/download/v2.1.9/circom-linux-amd64
  chmod +x /tmp/circom
  sudo mv /tmp/circom /usr/local/bin/circom
fi

echo ""
echo "✓ Toolchain installed:"
solana --version
anchor --version
circom --version

echo ""
echo "Next step:  bash scripts/deploy-all.sh"
