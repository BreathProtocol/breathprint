# BreathPrint — Biometric Verification

> Where humanity and technology becomes one.

**BreathPrint** is the biometric verification flow for [Breath Protocol](https://www.breath.id) — a multi-step capture pipeline that turns a single breath, a facial micro-structure scan, and a geolocation reading into a Zero-Knowledge proof of personhood, settled on Solana.

This is the app that runs at <https://verify.breath.id>. It is invoked from the [Vertebra Atlas](https://github.com/BreathProtocol/breath-protocol) dashboard whenever a holder needs to (re-)attest their humanity.

---

## What this app does

A holder lands here from the dashboard with an authenticated session and walks through three steps:

1. **Geolocation** — captures latitude / longitude as a witness to the attestation
2. **Facial** — captures a pore-level micro-structure embedding via the device camera; never leaves the browser
3. **Breath** — captures rhythm + exhale signature as a liveness signal

Each step yields a private witness. A Zero-Knowledge circuit (Groth16 over the Hermez precomputed Powers of Tau) proves the three witnesses jointly satisfy the human-liveness predicate. The succinct proof is submitted to the on-chain verifier program; on success, a Proof of Personhood credential is issued and the holder is bounced back to the dashboard.

## Stack

- **Framework:** Next.js (App Router) · React · TypeScript — under a Turborepo workspace
- **ZK:** circom + snarkjs (Groth16) · custom circuits in `packages/circuits`
- **Solana:** Anchor program in `packages/program` · Helius RPC · `@solana/web3.js` from the web app
- **Biometrics:** MediaPipe FaceMesh · ONNX-quantised breath classifier (`apps/web/public/models/breath_classifier.onnx`)
- **Auth handoff:** Supabase access tokens passed via `?token=…` from the dashboard
- **Design:** Tailwind v4 · cream-and-terracotta palette to match the rest of the Breath Protocol surface
- **Hosting:** Vercel (auto-deploy from `main` → verify.breath.id)

## Repository layout

```
apps/
  web/        Next.js verification UI (this is what runs at verify.breath.id)
  api/        Backend services (ZK proof generation, on-chain submission)
  streamlit/  Internal review tools
packages/
  circuits/   Circom circuits + ptau ceremony artifacts
  program/    Anchor on-chain verifier
docs/         Protocol & integration documentation
```

## Local development

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # populate API + Solana keys
npm run dev                                    # turbo dev across all workspaces
# web at http://localhost:3000
```

Important environment variables (web app):

- `NEXT_PUBLIC_API_URL` — backend verification API
- `NEXT_PUBLIC_SOLANA_NETWORK` — `devnet` or `mainnet-beta`
- `NEXT_PUBLIC_HELIUS_API_KEY` — RPC access
- `NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID` — deployed Anchor program ID
- `NEXT_PUBLIC_BYPASS_AUTH` — set to `1` to skip the Supabase token handoff during development

## Related projects

- **[breath-protocol](https://github.com/BreathProtocol/breath-protocol)** — the Vertebra Atlas dashboard at <https://vertebra.breath.id> that launches this flow.
- **breath-landing** — the marketing landing at <https://www.breath.id>.

## Contact

`contato@breath.id`
