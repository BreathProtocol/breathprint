/**
 * BreathPrint SDK — main entry point
 *
 * High-level orchestrator that wires together biometrics, ZK proof generation,
 * and Light Protocol on-chain submission.
 *
 * Typical usage from the Next.js app:
 *
 *   const sdk = new BreathPrint({
 *     heliusApiKey: process.env.NEXT_PUBLIC_HELIUS_API_KEY!,
 *     provider,
 *     idl,
 *     circuits: {
 *       registration: { wasm: "/circuits/breath_identity.wasm",
 *                       zkey: "/circuits/breath_identity_final.zkey" },
 *       verification: { wasm: "/circuits/breath_identity_v.wasm",
 *                       zkey: "/circuits/breath_identity_v_final.zkey" },
 *     },
 *   });
 *   await sdk.init();
 *
 *   // Step 2 — face capture
 *   const reg = await sdk.register(faceFrames);
 *   localStorage.setItem("bp_template", JSON.stringify(reg.template));
 *
 *   // Step 3 — breathing capture
 *   const stored = JSON.parse(localStorage.getItem("bp_template")!);
 *   const ver = await sdk.verify(breathFrames, stored);
 */

import type { AnchorProvider } from "@coral-xyz/anchor";

import * as biometrics from "./biometrics.js";
import * as zkproof from "./zkproof.js";
import {
  BreathPrintClient,
  type RegistrationResult,
  type VerificationResult,
  type IdentityStatus,
} from "./light.js";

export { biometrics, zkproof };
export {
  BreathPrintClient,
  type RegistrationResult,
  type VerificationResult,
  type IdentityStatus,
};

export interface BreathPrintConfig {
  provider: AnchorProvider;
  idl: any;
  heliusApiKey: string;
  circuits: {
    registration: zkproof.CircuitPaths;
    verification: zkproof.CircuitPaths;
  };
  /** Optional MediaPipe / ArcFace overrides */
  biometrics?: biometrics.BiometricInitOptions;
}

export interface StoredTemplate {
  chunks: string[]; // bigint serialized as decimal string
  salt: string;     // bigint serialized as decimal string
}

export interface RegisterReturn extends RegistrationResult {
  /** Persist this client-side (encrypted with wallet sig). Required for verify(). */
  template: StoredTemplate;
  livenessScore: number;
}

export class BreathPrint {
  private client: BreathPrintClient;
  private cfg: BreathPrintConfig;
  private initialized = false;

  constructor(cfg: BreathPrintConfig) {
    this.cfg = cfg;
    this.client = new BreathPrintClient(cfg.provider, cfg.idl, cfg.heliusApiKey);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      biometrics.init(this.cfg.biometrics),
      zkproof.init(),
      this.client.init(),
    ]);
    this.initialized = true;
  }

  /**
   * Step 2 — Face registration.
   * Extracts face embedding, quantizes, generates a fresh salt, registers
   * the commitment on-chain via Light Protocol.
   */
  async register(faceFrames: ImageData[]): Promise<RegisterReturn> {
    this.ensureInit();

    const livenessScore = await biometrics.computeLivenessScore(faceFrames);
    if (livenessScore < biometrics.constants.LIVENESS_THRESHOLD) {
      throw new Error(
        `Liveness check failed (${livenessScore.toFixed(2)} < ${biometrics.constants.LIVENESS_THRESHOLD}). ` +
          `Hold camera steady and ensure you're not showing a static photo.`
      );
    }

    const face = await biometrics.extractFaceEmbedding(faceFrames);
    // For registration we only need the face — but the LSH expects a breath
    // vector slot. Use a zeroed breath vector; verification will fill it from
    // the breathing capture. (The face bits dominate the 256-bit template.)
    const zeroBreath = new Float32Array(biometrics.constants.BREATH_DIM);
    const template = biometrics.quantizeToBinary(face, zeroBreath);

    const salt = randomSalt();
    const result = await this.client.registerBiometric(
      template.chunks,
      salt,
      this.cfg.circuits.registration.wasm,
      this.cfg.circuits.registration.zkey
    );

    return {
      ...result,
      livenessScore,
      template: {
        chunks: template.chunks.map((c) => c.toString()),
        salt: salt.toString(),
      },
    };
  }

  /**
   * Step 3 — Breathing verification.
   * Re-extracts face from the breathing video, verifies it matches the stored
   * template, generates the verification proof, submits on-chain.
   */
  async verify(
    combinedFrames: ImageData[],
    stored: StoredTemplate,
    threshold: number = 25
  ): Promise<VerificationResult & { livenessScore: number }> {
    this.ensureInit();

    const livenessScore = await biometrics.computeLivenessScore(combinedFrames);
    if (livenessScore < biometrics.constants.LIVENESS_THRESHOLD) {
      throw new Error(`Liveness check failed (${livenessScore.toFixed(2)})`);
    }

    const [face, breath] = await Promise.all([
      biometrics.extractFaceEmbedding(combinedFrames),
      biometrics.extractBreathSignature(combinedFrames),
    ]);
    const newTemplate = biometrics.quantizeToBinary(face, breath);

    const storedChunks = stored.chunks.map((s) => BigInt(s));
    const salt = BigInt(stored.salt);

    const result = await this.client.verifyBreathing(
      storedChunks,
      newTemplate.chunks,
      salt,
      this.cfg.circuits.verification.wasm,
      this.cfg.circuits.verification.zkey,
      threshold
    );

    return { ...result, livenessScore };
  }

  /** Pass-through to BreathPrintClient for explorer use. */
  getClient(): BreathPrintClient {
    return this.client;
  }

  private ensureInit() {
    if (!this.initialized) throw new Error("BreathPrint.init() must be called first");
  }
}

/** 64-bit random salt as a BigInt. */
export function randomSalt(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = 0n;
  for (const b of buf) s = (s << 8n) | BigInt(b);
  return s;
}
