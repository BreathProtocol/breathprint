/**
 * BreathPrint — ZK proof generation
 *
 * Wraps snarkjs Groth16 prover for the two BreathPrint circuits:
 *   - BiometricCommitment       (registration)
 *   - BiometricVerification     (breathing step)
 *
 * Circuit artifacts (.wasm + final.zkey) are produced by circuits/build.sh
 * and served from the consuming app's /public dir at runtime.
 */

// @ts-expect-error — no types ship with snarkjs
import * as snarkjs from "snarkjs";
// @ts-expect-error — no types ship with circomlibjs
import { buildPoseidon } from "circomlibjs";

export interface CircuitPaths {
  /** Path / URL to the compiled .wasm */
  wasm: string;
  /** Path / URL to the final .zkey */
  zkey: string;
}

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface ProveResult {
  proof: Groth16Proof;
  publicSignals: string[];
  /** ABI-packed proof bytes for on-chain submission (flattened uint8 array). */
  proofBytes: Uint8Array;
}

let poseidon: any | null = null;

export async function init(): Promise<void> {
  if (!poseidon) {
    poseidon = await buildPoseidon();
  }
}

/**
 * Poseidon(template_chunks[8] || salt) → BigInt (BN254 field element).
 */
export function computeCommitment(
  templateChunks: bigint[],
  salt: bigint
): bigint {
  if (!poseidon) throw new Error("zkproof.init() must be called first");
  if (templateChunks.length !== 8)
    throw new Error("templateChunks must have 8 entries (256-bit template)");

  const inputs = [...templateChunks.map((c) => c.toString()), salt.toString()];
  const hashFr = poseidon(inputs);
  return BigInt(poseidon.F.toString(hashFr));
}

/**
 * Generate a registration proof (BiometricCommitment circuit).
 * Public signal: commitment (single field element).
 */
export async function generateRegistrationProof(
  templateChunks: bigint[],
  salt: bigint,
  paths: CircuitPaths
): Promise<ProveResult> {
  const input = {
    template: templateChunks.map((c) => c.toString()),
    salt: salt.toString(),
    commitment: computeCommitment(templateChunks, salt).toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    paths.wasm,
    paths.zkey
  );

  return {
    proof,
    publicSignals,
    proofBytes: serializeProof(proof),
  };
}

/**
 * Generate a verification proof (BiometricVerification circuit).
 * Asserts Hamming(registered, new) < threshold AND H(registered || salt) == commitment.
 * Public signals: [commitment, threshold].
 */
export async function generateVerificationProof(
  registeredChunks: bigint[],
  newChunks: bigint[],
  salt: bigint,
  threshold: number,
  paths: CircuitPaths
): Promise<ProveResult> {
  if (threshold < 0 || threshold > 256)
    throw new Error("threshold must be 0..256");

  const commitment = computeCommitment(registeredChunks, salt);
  const input = {
    registered_template: registeredChunks.map((c) => c.toString()),
    new_template: newChunks.map((c) => c.toString()),
    salt: salt.toString(),
    commitment: commitment.toString(),
    threshold: threshold.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    paths.wasm,
    paths.zkey
  );

  return {
    proof,
    publicSignals,
    proofBytes: serializeProof(proof),
  };
}

/**
 * Hamming distance between two 8-chunk templates. Useful for client-side
 * pre-check before bothering to generate a full ZK proof.
 */
export function hammingDistance(a: bigint[], b: bigint[]): number {
  if (a.length !== b.length) throw new Error("template length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      d += Number(x & 1n);
      x >>= 1n;
    }
  }
  return d;
}

export function similarity(a: bigint[], b: bigint[]): number {
  return 1 - hammingDistance(a, b) / 256;
}

// ── Internals ─────────────────────────────────────────────────────

/**
 * Pack a Groth16 proof into a 256-byte buffer:
 *   pi_a[0..1] (64) || pi_b[0..1][0..1] (128) || pi_c[0..1] (64)
 * Each field element = 32 bytes big-endian. Matches the format
 * the on-chain `proof_data: Vec<u8>` argument expects (≥128 bytes guard).
 */
function serializeProof(proof: Groth16Proof): Uint8Array {
  const buf = new Uint8Array(256);
  let offset = 0;

  const writeField = (v: string) => {
    const bytes = bigIntToBytes(BigInt(v), 32);
    buf.set(bytes, offset);
    offset += 32;
  };

  writeField(proof.pi_a[0]);
  writeField(proof.pi_a[1]);
  writeField(proof.pi_b[0][0]);
  writeField(proof.pi_b[0][1]);
  writeField(proof.pi_b[1][0]);
  writeField(proof.pi_b[1][1]);
  writeField(proof.pi_c[0]);
  writeField(proof.pi_c[1]);

  return buf;
}

function bigIntToBytes(x: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
