# BreathPrint — End-to-End Setup Guide

Everything you need to get the Light Protocol integration live on Solana
devnet. Designed for slow laptops — most heavy lifting is done in **GitHub
Codespaces** (free cloud VM in your browser).

---

## 0 · Prerequisites

| Item | Where | One-time? |
|---|---|---|
| GitHub account with access to `BreathProtocol` org | already done | ✓ |
| Vercel project linked to this repo | already done | ✓ |
| Helius API key | https://helius.dev (free tier OK) | ✓ |
| Web3Auth Client ID | https://dashboard.web3auth.io | ✓ |

---

## 1 · Open a Codespace (replaces local install)

1. Go to https://github.com/BreathProtocol/breathprint
2. Click **Code** → **Codespaces** → **Create codespace on `light-protocol-integration`**
3. Wait ~2 min for the container to spin up

You now have a full Linux env in your browser. Everything below runs there.

---

## 2 · Install Solana + Anchor toolchain (once per Codespace)

```bash
# Solana CLI (~1 min)
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

# Anchor (~3 min — compiles from source)
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.30.1

# Circom (for circuit build, ~2 min)
cargo install --git https://github.com/iden3/circom.git
```

Verify:
```bash
solana --version    # solana-cli 1.18.22
anchor --version    # anchor-cli 0.30.1
circom --version    # circom 2.x
```

---

## 3 · Create a Solana keypair + fund it

```bash
# Generate a fresh keypair (saved to ~/.config/solana/id.json)
solana-keygen new --no-bip39-passphrase

# Point the CLI at devnet
solana config set --url https://api.devnet.solana.com

# Show your public key (this is your "wallet address" on devnet)
solana address

# Top up with free devnet SOL (run 2-3 times if it fails — devnet faucet is rate-limited)
solana airdrop 5
solana balance
```

⚠️ **The `id.json` file IS your private key.** Don't commit it. The
`.gitignore` already excludes it but double-check.

---

## 4 · Build + deploy the Anchor program

```bash
cd solana-program

# Generate the program's own keypair (this fixes the program ID)
anchor keys list

# Update declare_id! in src/lib.rs and the [programs.devnet] entry in
# Anchor.toml with the program ID printed above.

# Build (~2 min)
anchor build

# Sync the keys (Anchor sometimes regenerates a different ID)
anchor keys sync

# Deploy (~30 sec — uses your funded keypair from step 3)
anchor deploy --provider.cluster devnet
```

Output looks like:
```
Program Id: 7xKj9...PHe2
Deploy success
```

**Save that Program Id.** You'll plug it into:
- `solana-program/src/lib.rs` → `declare_id!("...")` (already in sync)
- Vercel env: `NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID`

Verify the program exists:
```
https://solscan.io/account/<YOUR_PROGRAM_ID>?cluster=devnet
```

---

## 5 · Compile the ZK circuit

```bash
cd circuits
npm install
bash build.sh
```

Output goes to `circuits/build/`:
- `breath_identity.wasm`        ← prover input
- `breath_identity_final.zkey`  ← proving key
- `verification_key.json`       ← (optional) on-chain verifier

Copy the artifacts so the web app can serve them:

```bash
mkdir -p ../apps/web/public/circuits
cp build/breath_identity_js/breath_identity.wasm ../apps/web/public/circuits/
cp build/breath_identity_final.zkey               ../apps/web/public/circuits/
```

Commit them — these are static artifacts the browser downloads at runtime.

---

## 6 · Download the ArcFace face-recognition model

ArcFace converts a face image → 512 numbers (an "embedding"). Two photos of
the same face give similar numbers; different faces give different numbers.
That's how Step 3 verifies the face matches Step 2.

**Model: ArcFace ResNet-100 (~249 MB)** from the official ONNX Model Zoo —
the same architecture used in the InsightFace paper.

```bash
mkdir -p apps/web/public/models
cd apps/web/public/models

# Full ArcFace ResNet-100 ONNX (~249 MB)
curl -L -o arcface.onnx \
  https://github.com/onnx/models/raw/main/validated/vision/body_analysis/arcface/model/arcfaceresnet100-8.onnx

ls -lh arcface.onnx   # should print ~249M
```

### ⚠️ Git LFS required (file is > 100 MB)

GitHub blocks pushes of regular files larger than 100 MB. Install Git LFS
first, then track the model:

```bash
# In the Codespace (already pre-installed) or locally:
git lfs install

# From the repo root:
git lfs track "apps/web/public/models/*.onnx"
git add .gitattributes
git add apps/web/public/models/arcface.onnx
git commit -m "Add ArcFace ResNet-100 ONNX via LFS"
git push
```

Vercel supports Git LFS automatically — no extra config needed. The
browser fetches `/models/arcface.onnx` at runtime; first load takes a few
seconds on slow connections.

### Alternative: host externally

If you'd rather not store a 249 MB blob in git, upload `arcface.onnx` to
any CDN (Vercel Blob, Supabase Storage, Cloudflare R2, S3) and override
the model URL:

```bash
# In Vercel env:
NEXT_PUBLIC_ARCFACE_MODEL_URL=https://your-cdn.com/arcface.onnx
```

Then pass that URL when initializing the SDK:
```ts
await sdk.init({ biometrics: { arcfaceModelUrl: process.env.NEXT_PUBLIC_ARCFACE_MODEL_URL } });
```

---

## 7 · Wire up environment variables in Vercel

Vercel Dashboard → your project → **Settings → Environment Variables** →
add for **all environments** (Production / Preview / Development):

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_HELIUS_API_KEY` | from helius.dev | required |
| `NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID` | from step 4 | required |
| `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` | required |
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` | from dashboard.web3auth.io | for login |
| `NEXT_PUBLIC_WEB3AUTH_NETWORK` | `sapphire_devnet` | testing tier |

After adding, hit **Redeploy** on the latest deployment so the new env vars take effect.

---

## 8 · Verify it's working

After Vercel redeploys, visit:

```
https://<your-deploy>.vercel.app/explorer?wallet=<your_solana_address>
```

You should see your Specimen card + an empty attestations list (because no
biometric has been registered yet). If you see "RPC ERROR", double-check
`NEXT_PUBLIC_HELIUS_API_KEY` in Vercel.

To test a registration without the full UI flow, use the SDK from a Node
script:

```bash
cd packages/sdk
npm install
npm run build
# Then write a small register script using @repo/sdk's BreathPrintClient
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `anchor deploy` fails with "insufficient funds" | not enough devnet SOL | `solana airdrop 2` (rate-limited; try multiple times or use https://faucet.solana.com) |
| Vercel build fails on `@solana/web3.js` | missing dep | already added to `apps/web/package.json` — check the latest commit is deployed |
| `/explorer` shows "RPC ERROR · 401" | bad Helius key | regenerate at helius.dev, update Vercel env |
| Program ID mismatch | `declare_id!` in lib.rs doesn't match deployed | run `anchor keys sync` then `anchor build && anchor deploy` again |
| `Light Protocol indexer not found` | Helius free tier doesn't include compression | upgrade to Developer plan (~$50/mo) or use https://photon.helius.dev |

---

## Quick reference — what runs where

| Task | Runs on | Why |
|---|---|---|
| `anchor deploy` | Codespace / your machine | Talks to Solana, not Vercel |
| `bash build.sh` | Codespace, **once** | Generates static artifacts, then committed |
| Download arcface.onnx | Codespace, **once** | Static model file, committed |
| `next build` | Vercel | That's what Vercel does |
| `/verify` and `/explorer` pages | Vercel (browser) | Standard Next.js |
| Solana RPC calls (registration, queries) | User's browser → Helius | Pure client-side |
