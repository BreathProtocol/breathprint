/**
 * BreathPrint — Light Protocol Client
 *
 * Handles compressed PDA creation and querying via Light Protocol.
 * Each biometric identity is stored as a compressed account (~0.000015 SOL).
 */

import { Rpc, createRpc } from "@lightprotocol/stateless.js";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

// ── Configuration ──────────────────────────────────────────

const BREATHPRINT_PROGRAM_ID = new PublicKey("BPrnt1111111111111111111111111111111111111");

// Helius RPC with Light Protocol indexer (devnet)
const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY";
const COMPRESSION_RPC = HELIUS_RPC; // Helius bundles the compression indexer

// ── Types ──────────────────────────────────────────────────

export interface RegistrationResult {
  commitment: Uint8Array;
  txSignature: string;
  solscanUrl: string;
  templateChunks: bigint[];
  salt: bigint;
}

export interface VerificationResult {
  matched: boolean;
  similarity: number;
  txSignature: string;
  solscanUrl: string;
}

export interface IdentityStatus {
  owner: string;
  commitment: string;
  isVerified: boolean;
  verificationCount: number;
  registeredAt: number;
  lastVerifiedAt: number;
}

// ── Light Protocol Client ──────────────────────────────────

export class BreathPrintClient {
  private rpc: Rpc;
  private program: Program;
  private poseidon: any;

  constructor(
    private provider: AnchorProvider,
    idl: any,
    heliusApiKey: string,
  ) {
    const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;
    this.rpc = createRpc(rpcUrl, rpcUrl); // RPC + indexer same endpoint for Helius
    this.program = new Program(idl, BREATHPRINT_PROGRAM_ID, provider);
  }

  async init() {
    this.poseidon = await buildPoseidon();
  }

  // ── Step 2: Register Face Biometric ────────────────────

  /**
   * Register a face biometric as a compressed PDA via Light Protocol.
   *
   * Flow:
   *   1. Receive template chunks from browser-side face extraction
   *   2. Compute Poseidon commitment
   *   3. Generate Groth16 proof (client-side)
   *   4. Submit to Solana → creates compressed PDA
   *   5. Return tx signature for Solscan explorer
   */
  async registerBiometric(
    templateChunks: bigint[],
    salt: bigint,
    wasmPath: string,
    zkeyPath: string,
  ): Promise<RegistrationResult> {
    // 1. Compute Poseidon commitment
    const commitmentBigInt = this.computeCommitment(templateChunks, salt);
    const commitment = this.bigintToBytes32(commitmentBigInt);

    // 2. Generate ZK proof
    const { proof } = await snarkjs.groth16.fullProve(
      {
        template: templateChunks.map(String),
        salt: salt.toString(),
        commitment: commitmentBigInt.toString(),
      },
      wasmPath,
      zkeyPath,
    );

    // 3. Serialize proof for on-chain submission
    const proofBytes = this.serializeProof(proof);

    // 4. Submit transaction via Light Protocol compressed PDA
    const txSignature = await this.program.methods
      .registerBiometric(
        Array.from(commitment),
        Buffer.from(proofBytes),
      )
      .accounts({
        signer: this.provider.wallet.publicKey,
      })
      .rpc();

    const solscanUrl = `https://solscan.io/tx/${txSignature}?cluster=devnet`;

    return {
      commitment,
      txSignature,
      solscanUrl,
      templateChunks,
      salt,
    };
  }

  // ── Step 3: Verify Breathing ───────────────────────────

  /**
   * Verify breathing + face match against registered biometric.
   *
   * Flow:
   *   1. Browser captures face + breathing motion
   *   2. New face template is compared to registered template
   *   3. If Hamming distance < threshold → match
   *   4. ZK proof proves match without revealing biometrics
   *   5. Submit verification to Solana → updates compressed PDA
   */
  async verifyBreathing(
    registeredChunks: bigint[],
    newChunks: bigint[],
    salt: bigint,
    verificationWasmPath: string,
    verificationZkeyPath: string,
    threshold: number = 25,
  ): Promise<VerificationResult> {
    // 1. Check similarity locally first
    const hammingDistance = this.computeHamming(registeredChunks, newChunks);
    const similarity = 1 - hammingDistance / 256;

    if (similarity < 0.9) {
      return {
        matched: false,
        similarity,
        txSignature: "",
        solscanUrl: "",
      };
    }

    // 2. Generate verification ZK proof
    const commitment = this.computeCommitment(registeredChunks, salt);
    const { proof } = await snarkjs.groth16.fullProve(
      {
        registered_template: registeredChunks.map(String),
        new_template: newChunks.map(String),
        salt: salt.toString(),
        commitment: commitment.toString(),
        threshold: threshold.toString(),
      },
      verificationWasmPath,
      verificationZkeyPath,
    );

    const proofBytes = this.serializeProof(proof);

    // 3. Submit verification
    const txSignature = await this.program.methods
      .verifyBreathing(
        Buffer.from(proofBytes),
        threshold,
      )
      .accounts({
        signer: this.provider.wallet.publicKey,
      })
      .rpc();

    const solscanUrl = `https://solscan.io/tx/${txSignature}?cluster=devnet`;

    return {
      matched: true,
      similarity,
      txSignature,
      solscanUrl,
    };
  }

  // ── Explorer: Query Identity Status ────────────────────

  /**
   * Fetch identity status from compressed PDA.
   * Used by the dashboard explorer panel.
   */
  async getIdentityStatus(walletPubkey: PublicKey): Promise<IdentityStatus | null> {
    try {
      // Query compressed accounts owned by the program, filtered by wallet
      const accounts = await this.rpc.getCompressedAccountsByOwner(
        BREATHPRINT_PROGRAM_ID,
      );

      // Find the one matching this wallet
      for (const account of accounts.items) {
        // Deserialize compressed account data
        const data = this.deserializeIdentity(account.data?.data || new Uint8Array());
        if (data && data.owner === walletPubkey.toBase58()) {
          return data;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get all transaction signatures for this identity.
   * Used by the explorer to show Solscan links.
   */
  async getTransactionHistory(walletPubkey: PublicKey): Promise<{
    signature: string;
    solscanUrl: string;
    type: "registration" | "verification" | "revocation";
    timestamp: number;
  }[]> {
    try {
      const signatures = await this.rpc.getCompressionSignaturesForOwner(
        walletPubkey,
      );

      return signatures.items.map((sig: any) => ({
        signature: sig.signature,
        solscanUrl: `https://solscan.io/tx/${sig.signature}?cluster=devnet`,
        type: "registration" as const, // TODO: parse event type from logs
        timestamp: sig.blockTime || 0,
      }));
    } catch {
      return [];
    }
  }

  // ── Helpers ────────────────────────────────────────────

  computeCommitment(templateChunks: bigint[], salt: bigint): bigint {
    const hash = this.poseidon([...templateChunks.map(Number), Number(salt)]);
    return BigInt(this.poseidon.F.toString(hash));
  }

  private computeHamming(a: bigint[], b: bigint[]): number {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      const xor = a[i] ^ b[i];
      dist += xor.toString(2).split("").filter(c => c === "1").length;
    }
    return dist;
  }

  private bigintToBytes32(v: bigint): Uint8Array {
    return Uint8Array.from(Buffer.from(v.toString(16).padStart(64, "0"), "hex"));
  }

  private serializeProof(proof: snarkjs.Groth16Proof): Uint8Array {
    // Serialize Groth16 proof points to bytes
    const json = JSON.stringify(proof);
    return new TextEncoder().encode(json);
  }

  private deserializeIdentity(data: Uint8Array): IdentityStatus | null {
    if (data.length === 0) return null;
    try {
      // Anchor-compatible deserialization
      // Skip 8-byte discriminator
      const view = new DataView(data.buffer, data.byteOffset + 8);
      const ownerBytes = data.slice(8, 40);
      const commitmentBytes = data.slice(40, 72);

      return {
        owner: new PublicKey(ownerBytes).toBase58(),
        commitment: Buffer.from(commitmentBytes).toString("hex"),
        registeredAt: Number(view.getBigInt64(64, true)),
        lastVerifiedAt: Number(view.getBigInt64(72, true)),
        verificationCount: view.getUint32(80, true),
        isVerified: view.getUint8(84) === 1,
      };
    } catch {
      return null;
    }
  }
}
