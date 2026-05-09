#!/usr/bin/env bash
# One-shot toolchain installer — run this if postCreateCommand didn't execute
# automatically (or if you cloned the repo locally instead of via Codespaces).
#
# Installs:
#   - Solana CLI v1.18.22
#   - Anchor v0.30.1 (via avm)
#   - Circom v2.1.9 (precompiled binary)
#
#   bash scripts/install-toolchain.sh

set -euo pipefail

echo "▸ [1/3] Solana CLI v1.18.22"
if ! command -v solana &> /dev/null; then
  sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"
else
  echo "  ✓ already installed: $(solana --version)"
fi

# Persist PATH for future shells
SOLANA_PATH_LINE='export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"'
if ! grep -qF "$SOLANA_PATH_LINE" ~/.bashrc 2>/dev/null; then
  echo "$SOLANA_PATH_LINE" >> ~/.bashrc
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo ""
echo "▸ [2/3] Anchor v0.30.1 (via avm — ~3 min compile on first run)"
if ! command -v avm &> /dev/null; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
fi
avm install 0.30.1
avm use 0.30.1

echo ""
echo "▸ [3/3] Circom (compile from source — ~2 min, works on any glibc)"
if ! command -v circom &> /dev/null; then
  cargo install --git https://github.com/iden3/circom.git --force
  # Older fallback path: precompiled binary (often fails with GLIBC errors on
  # Codespace base image). Kept commented for reference.
  # curl -L -o /tmp/circom https://github.com/iden3/circom/releases/download/v2.1.9/circom-linux-amd64
  # chmod +x /tmp/circom
  # sudo mv /tmp/circom /usr/local/bin/circom
else
  echo "  ✓ already installed: $(circom --version)"
fi

echo ""
echo "─────────────────────────────────────────────"
echo "✓ Toolchain ready:"
solana --version
anchor --version
circom --version
echo ""
echo "Now run:  bash scripts/deploy-all.sh"
echo "─────────────────────────────────────────────"
