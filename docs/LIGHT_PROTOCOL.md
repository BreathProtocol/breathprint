# BreathPrint — Light Protocol ZK Integration

## The Flow (What the User Experiences)

```
1. LOCATION CHECK     → GPS verification → approved jurisdiction
2. FACE BIOMETRIC     → Camera captures face → ArcFace embedding
                        → Quantized to 256-bit template
                        → Poseidon hash → commitment
                        → ZK proof generated (client-side snarkjs)
                        → Compressed PDA created via Light Protocol
                        → Linked to logged-in wallet account
                        → Transaction signature saved

3. BREATHING MOTION   → Same camera captures face + breath in/out
                        → Face is RE-VERIFIED against step 2 commitment
                        → Breathing pattern validates liveness
                        → Verification proof submitted on-chain
                        → Dashboard shows "VERIFIED" status

4. DASHBOARD EXPLORER → Shows Solscan links for:
                        • Registration transaction
                        • Verification transaction
                        • Compressed account data
```

## Why Light Protocol

- Compressed PDA costs ~0.000015 SOL vs ~0.002 SOL (130x cheaper)
- Built-in ZK verification infrastructure
- Solana Attestation Service (SAS) template for KYC credentials
- No rent — biometric records persist without ongoing cost
- MCP server for Claude Code: `https://www.zkcompression.com/mcp`

## Claude Code Setup

Add these MCP servers for development:

```bash
claude mcp add -s user -t http zkcompression https://www.zkcompression.com/mcp
claude mcp add -s user -t http deepwiki https://mcp.deepwiki.com/mcp
```

## Architecture (for Claude Code prompts)

```
breathprint/
├── solana-program/         # Anchor + Light SDK compressed PDA program
│   └── src/lib.rs          # register_biometric + verify_breathing
├── sdk/                    # TypeScript SDK
│   └── src/
│       ├── index.ts        # Main orchestrator
│       ├── biometrics.ts   # Face + breath extraction (browser-side)
│       ├── zkproof.ts      # snarkjs proof generation
│       └── light.ts        # Light Protocol compressed PDA client
├── explorer/               # React component for dashboard
│   └── ExplorerPanel.tsx   # Solscan transaction viewer
├── circuits/               # Circom ZK circuits
│   └── breath_identity.circom
└── claude-code/            # Prompt sequences for Claude Code
    └── prompts.md          # Step-by-step prompts
```

## Implementation Order (for hackathon)

1. `circuits/` — Build ZK circuit, generate wasm + zkey
2. `solana-program/` — Deploy Anchor + Light SDK program to devnet
3. `sdk/` — Wire up biometrics → ZK → Light Protocol submission
4. `explorer/` — Solscan viewer component for dashboard
5. Integration test — full flow on devnet

## Dependencies

```bash
# Solana program
cargo add light-sdk light-sdk-macros anchor-lang

# TypeScript SDK
npm install @lightprotocol/stateless.js @lightprotocol/compressed-token
npm install @solana/web3.js @coral-xyz/anchor
npm install snarkjs circomlibjs
npm install @mediapipe/face_mesh onnxruntime-web

# Circuit
npm install circomlib snarkjs
```

## RPC Endpoints

- **Devnet**: `https://devnet.helius-rpc.com/?api-key=YOUR_KEY`
- Light Protocol indexer is bundled with Helius RPC
- Solscan devnet: `https://solscan.io/tx/{signature}?cluster=devnet`
