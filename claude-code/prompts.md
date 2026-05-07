# BreathPrint — Claude Code Prompts

Copy-paste these prompts in order into Claude Code.

## 0. Setup MCP + Dependencies

```
Add these MCP servers for Light Protocol context:

claude mcp add -s user -t http zkcompression https://www.zkcompression.com/mcp
claude mcp add -s user -t http deepwiki https://mcp.deepwiki.com/mcp
```

Then install the AI skill:
```
npx skills add https://zkcompression.com
```

---

## 1. Build ZK Circuit

**Prompt:**
```
In the breathprint repo, create a circom circuit at circuits/breath_identity.circom that:
1. Takes 8 private inputs (template[8] as 32-bit chunks = 256-bit biometric template) and a private salt
2. Takes 1 public input: commitment
3. Uses Poseidon hash to prove H(template || salt) == commitment
4. Also create a BiometricVerification template that proves Hamming distance between two templates is below a threshold (25 bits for 90% match on 256-bit templates)
5. Create a build.sh that compiles with circom, runs powers of tau ceremony, and exports wasm + zkey files

Install circomlib and snarkjs as dev dependencies.
```

---

## 2. Create Solana Program with Light Protocol

**Prompt:**
```
Create an Anchor program at solana-program/ that uses Light Protocol compressed PDAs 
(light-sdk crate) to store biometric identity data cheaply on Solana.

The program needs two instructions:

1. register_biometric(commitment: [u8; 32], proof_data: Vec<u8>)
   - Creates a compressed PDA (via Light Protocol) storing:
     owner (Pubkey), commitment ([u8;32]), registered_at (i64), 
     is_verified (bool), verification_count (u32), last_verified_at (i64)
   - Seeds: [b"identity", signer.key().as_ref()]
   - is_verified starts as false
   - Emit BiometricRegistered event

2. verify_breathing(verification_proof: Vec<u8>, threshold: u8)
   - Mutates the compressed PDA to set is_verified = true
   - Increments verification_count
   - Only owner can call
   - Emit BreathingVerified event

Use light_account and light_accounts macros.
Add Cargo.toml with dependencies: anchor-lang, light-sdk, light-sdk-macros.
Target Solana devnet.

Reference the Light Protocol docs via the zkcompression MCP server.
```

---

## 3. Deploy to Devnet

**Prompt:**
```
Deploy the breathprint Anchor program to Solana devnet.

1. Run anchor build
2. Get the program keypair and update declare_id! in lib.rs
3. Run anchor deploy --provider.cluster devnet
4. Save the program ID — we need it for the SDK

Make sure I have enough SOL: solana airdrop 5

After deploying, verify the program exists on Solscan devnet.
```

---

## 4. Build the TypeScript SDK

**Prompt:**
```
Create a TypeScript SDK at sdk/src/ with these files:

sdk/src/light.ts — Light Protocol client:
- Uses @lightprotocol/stateless.js createRpc()
- registerBiometric(): generates Poseidon commitment from template chunks + salt, 
  generates Groth16 proof with snarkjs, submits to Anchor program, returns tx signature + Solscan URL
- verifyBreathing(): computes Hamming distance between registered and new template, 
  generates verification proof, submits on-chain, returns tx + Solscan URL
- getIdentityStatus(): queries compressed PDA via rpc.getCompressedAccountsByOwner()
- getTransactionHistory(): gets compression signatures for Solscan explorer

sdk/src/biometrics.ts — Browser-side face + breath extraction:
- Uses MediaPipe Face Mesh for face landmarks
- Uses ONNX Runtime + ArcFace model for 512-dim face embedding
- Extracts breathing motion from shoulder/chest oscillation
- LSH quantization: 512-dim face → 192 bits, 64-dim breath → 64 bits, total 256-bit template
- Returns 8 x 32-bit chunks

sdk/src/index.ts — Main orchestrator:
- BreathPrint class with init(), register(), verify() methods
- Handles the full pipeline from camera capture to on-chain submission

Dependencies: @lightprotocol/stateless.js, @solana/web3.js, @coral-xyz/anchor, 
snarkjs, circomlibjs, @mediapipe/face_mesh, onnxruntime-web

Use Helius RPC endpoint for both regular and compression RPC.
```

---

## 5. Integrate with BreathPrint Frontend

**Prompt:**
```
In the breath-protocol GitHub repo, integrate the SDK with the existing verification flow:

Step 2 (Face biometric — the FACE section in the UI):
- After camera captures face frames, call biometrics.extractFaceEmbedding()
- Quantize to template chunks via biometrics.quantizeToBinary()
- Generate ZK proof and register on-chain via breathPrintClient.registerBiometric()
- Store templateChunks and salt in localStorage (encrypted with wallet signature)
- Show Solscan link to the user
- Save tx signature for the explorer

Step 3 (Breathing — the BREATH section in the UI):
- Camera captures face + breathing motion simultaneously
- Extract new face template AND validate breathing pattern
- Call breathPrintClient.verifyBreathing() with stored template vs new template
- If similarity >= 90% → shows VERIFIED status on dashboard
- Show Solscan verification link

The face from Step 2 must match the face in Step 3 — that's the whole point.
```

---

## 6. Add Explorer to Dashboard

**Prompt:**
```
Add an Explorer section to the breath-protocol dashboard.

Create explorer/ExplorerPanel.tsx that shows:
1. Identity status card: verified/pending badge, wallet address (linked to Solscan), 
   commitment hash (shortened), registration date, verification count
2. Transaction history: list of registration/verification/revocation transactions 
   with Solscan links for each
3. "Verify on Solscan" section with direct links to wallet account and program account

Use the breathPrintClient.getIdentityStatus() and getTransactionHistory() methods.

Solscan URLs format: https://solscan.io/tx/{signature}?cluster=devnet

Style it to match the existing dashboard design (dark theme with Breath Protocol colors:
Obsidian #07080C background, Thermal Cyan #00D9FF accents, Vital Violet #5E2BFF highlights).

Add this to the sidebar navigation under "Explorer" (next to Credentials and Block explorer).
```

---

## 7. End-to-End Test

**Prompt:**
```
Create a test at tests/e2e.ts that:

1. Connects to devnet with a test wallet
2. Generates fake biometric template (8 random 32-bit chunks)
3. Registers biometric via the SDK → gets tx signature
4. Verifies the tx exists on Solscan
5. Generates a "new capture" with 90%+ similarity (flip <25 bits)
6. Runs verifyBreathing() → gets verification tx
7. Queries identity status → confirms is_verified = true
8. Logs all Solscan URLs

Run with: npx ts-node tests/e2e.ts
```

---

## Summary Flow

```
User logs in → connects wallet (Phantom)
     ↓
Step 1: Location check (GPS) → approved
     ↓
Step 2: Face biometric
  → Camera captures face
  → ArcFace embedding (512d) extracted in browser
  → LSH quantized to 256-bit template
  → Poseidon hash = commitment
  → Groth16 proof generated (snarkjs WASM)
  → Light Protocol compressed PDA created on Solana
  → TX signature stored for explorer
  → is_verified = false
     ↓
Step 3: Breathing verification  
  → Same camera captures face + breath in/out
  → New face template extracted
  → Hamming distance compared to Step 2 template
  → If match ≥ 90%: ZK proof generated
  → Verification submitted on-chain
  → is_verified = true
  → Dashboard shows VERIFIED badge
     ↓
Explorer: Shows all Solscan transaction links
```
