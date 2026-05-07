#!/usr/bin/env bash
# BreathPrint — full devnet deploy pipeline
#
# Run this from a Codespace (or any machine with Solana CLI + Anchor + circom).
# Idempotent — safe to re-run.
#
#   bash scripts/deploy-all.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Ensure tooling is on PATH ──────────────────────────────
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

if ! command -v solana &> /dev/null; then
  echo "✗ solana CLI not found. Run .devcontainer/postCreateCommand.sh first."
  exit 1
fi
if ! command -v anchor &> /dev/null; then
  echo "✗ anchor not found. Run .devcontainer/postCreateCommand.sh first."
  exit 1
fi
if ! command -v circom &> /dev/null; then
  echo "✗ circom not found. Run .devcontainer/postCreateCommand.sh first."
  exit 1
fi

# ── 2. Solana keypair (generate if missing) ───────────────────
KEYPAIR_PATH="$HOME/.config/solana/id.json"
if [ ! -f "$KEYPAIR_PATH" ]; then
  echo "▸ Generating new deployer keypair at $KEYPAIR_PATH"
  mkdir -p "$(dirname "$KEYPAIR_PATH")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$KEYPAIR_PATH"
fi
echo "  Deployer pubkey: $(solana-keygen pubkey "$KEYPAIR_PATH")"

# ── 3. Point CLI at devnet ────────────────────────────────────
solana config set --url https://api.devnet.solana.com > /dev/null

# ── 4. Airdrop SOL until balance ≥ 4 ──────────────────────────
get_balance() { solana balance --lamports | awk '{print $1}'; }
LAMPORTS=$(get_balance)
echo "  Current balance: $((LAMPORTS / 1000000000)) SOL ($LAMPORTS lamports)"

attempt=0
while [ "$LAMPORTS" -lt 4000000000 ] && [ $attempt -lt 5 ]; do
  attempt=$((attempt + 1))
  echo "▸ Airdropping 2 SOL (attempt $attempt/5)…"
  if solana airdrop 2 2>&1 | grep -q "Error"; then
    echo "  Faucet rate-limited, sleeping 10s…"
    sleep 10
  else
    sleep 5
  fi
  LAMPORTS=$(get_balance)
done

if [ "$LAMPORTS" -lt 2000000000 ]; then
  echo "✗ Couldn't get enough SOL via airdrop. Visit https://faucet.solana.com manually,"
  echo "  paste your pubkey, then re-run this script."
  exit 1
fi

# ── 5. Build + deploy Anchor program ──────────────────────────
echo ""
echo "▸ Building Anchor program (~2 min on first run)"
cd "$REPO_ROOT/solana-program"
anchor build

# Sync the declare_id! macro with the actual program keypair Anchor generated
echo "▸ Syncing program keys"
anchor keys sync || true
anchor build  # rebuild after key sync

PROGRAM_ID=$(anchor keys list 2>/dev/null | awk '/breathprint/ {print $2}')
echo "  Program ID: $PROGRAM_ID"

echo "▸ Deploying to devnet"
anchor deploy --provider.cluster devnet

# ── 6. Build ZK circuit ───────────────────────────────────────
echo ""
echo "▸ Compiling Circom circuit"
cd "$REPO_ROOT/circuits"
if [ ! -d node_modules ]; then
  npm install --silent
fi
bash build.sh

# ── 7. Stage artifacts into apps/web/public ───────────────────
echo ""
echo "▸ Copying artifacts to apps/web/public"
mkdir -p "$REPO_ROOT/apps/web/public/circuits"
cp build/breath_identity_js/breath_identity.wasm "$REPO_ROOT/apps/web/public/circuits/"
cp build/breath_identity_final.zkey               "$REPO_ROOT/apps/web/public/circuits/"

# IDL → consumable by the SDK
mkdir -p "$REPO_ROOT/apps/web/lib"
cp "$REPO_ROOT/solana-program/target/idl/breathprint.json" "$REPO_ROOT/apps/web/lib/breathprint-idl.json"

# ── 8. Done ───────────────────────────────────────────────────
cat <<EOF

═══════════════════════════════════════════════════════════════
✓ Deploy complete

  PROGRAM ID:  $PROGRAM_ID
  Solscan:     https://solscan.io/account/$PROGRAM_ID?cluster=devnet

NEXT STEPS

  1. Add this to Vercel env vars (BOTH projects):
       NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID = $PROGRAM_ID

  2. Commit the freshly built artifacts:
       git add apps/web/public/circuits/ apps/web/lib/breathprint-idl.json solana-program/
       git commit -m "Deploy program + ZK artifacts to devnet"
       git push

  3. Vercel will auto-redeploy with the new program ID + artifacts.
     Open https://breath-protocol.vercel.app/explorer to test.

═══════════════════════════════════════════════════════════════
EOF
