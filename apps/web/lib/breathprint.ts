/**
 * BreathPrint SDK bootstrap for apps/web.
 *
 * Lazily initializes a singleton BreathPrint orchestrator using the
 * Web3Auth-connected Solana provider as the AnchorProvider wallet.
 *
 * Skips on-chain steps gracefully if NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID is
 * unset or still the placeholder — the existing API-backed verify flow
 * keeps working unchanged. Once the program is deployed and the env var
 * is updated, registrations write to Solana automatically.
 */

import type { IProvider } from "@web3auth/base";
import type { PublicKey } from "@solana/web3.js";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_BREATHPRINT_PROGRAM_ID ?? "";
const PLACEHOLDER_PROGRAM_ID = "BPrnt1111111111111111111111111111111111111";
const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY ?? "";

const CIRCUIT_REG_WASM =
  process.env.NEXT_PUBLIC_CIRCUIT_REGISTRATION_WASM ?? "/circuits/breath_identity.wasm";
const CIRCUIT_REG_ZKEY =
  process.env.NEXT_PUBLIC_CIRCUIT_REGISTRATION_ZKEY ?? "/circuits/breath_identity_final.zkey";
const CIRCUIT_VER_WASM =
  process.env.NEXT_PUBLIC_CIRCUIT_VERIFICATION_WASM ?? "/circuits/breath_identity.wasm";
const CIRCUIT_VER_ZKEY =
  process.env.NEXT_PUBLIC_CIRCUIT_VERIFICATION_ZKEY ?? "/circuits/breath_identity_final.zkey";
const ARCFACE_MODEL_URL =
  process.env.NEXT_PUBLIC_ARCFACE_MODEL_URL ?? "/models/arcface.onnx";

export function isOnChainEnabled(): boolean {
  return Boolean(
    PROGRAM_ID &&
    PROGRAM_ID !== PLACEHOLDER_PROGRAM_ID &&
    HELIUS_API_KEY
  );
}

interface CapturedFrame {
  imageData: ImageData;
}

/**
 * Capture a single ImageData frame from a <video> element.
 * Returns null if the video isn't ready.
 */
export function captureFrame(video: HTMLVideoElement): ImageData | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Capture N frames spaced ~`intervalMs` apart from a video element. */
export async function captureFrames(
  video: HTMLVideoElement,
  count: number,
  intervalMs = 100
): Promise<ImageData[]> {
  const frames: ImageData[] = [];
  for (let i = 0; i < count; i++) {
    const f = captureFrame(video);
    if (f) frames.push(f);
    if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return frames;
}

export interface OnChainRegistration {
  txSignature: string;
  solscanUrl: string;
  template: { chunks: string[]; salt: string };
}

export interface OnChainVerification {
  txSignature: string;
  solscanUrl: string;
  similarity: number;
}

const STORAGE_KEY = "breathprint:template";

export function saveTemplate(t: OnChainRegistration["template"]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // Quota exceeded or SSR — non-fatal, on-chain step skipped next time.
  }
}

export function loadTemplate(): OnChainRegistration["template"] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OnChainRegistration["template"]) : null;
  } catch {
    return null;
  }
}

/**
 * Run the full on-chain registration for a face capture.
 *
 * @returns RegistrationResult with Solscan URL on success, or null if
 *   on-chain mode isn't configured (fall back to API-only flow).
 */
export async function registerOnChain(
  frames: ImageData[],
  provider: IProvider,
  publicKey: PublicKey
): Promise<OnChainRegistration | null> {
  if (!isOnChainEnabled()) return null;

  // Lazy-load the heavy SDK only when on-chain is enabled.
  const { BreathPrint } = await import("@repo/sdk");
  const { AnchorProvider } = await import("@coral-xyz/anchor");
  const { Connection } = await import("@solana/web3.js");
  const idl = (await import("./breathprint-idl.json")).default;

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";
  const rpcUrl = `https://${network}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const connection = new Connection(rpcUrl, "confirmed");

  const wallet = web3authWallet(provider, publicKey);
  const anchorProvider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const sdk = new BreathPrint({
    provider: anchorProvider,
    idl,
    heliusApiKey: HELIUS_API_KEY,
    circuits: {
      registration: { wasm: CIRCUIT_REG_WASM, zkey: CIRCUIT_REG_ZKEY },
      verification: { wasm: CIRCUIT_VER_WASM, zkey: CIRCUIT_VER_ZKEY },
    },
    biometrics: { arcfaceModelUrl: ARCFACE_MODEL_URL },
  });
  await sdk.init();
  const result = await sdk.register(frames);

  saveTemplate(result.template);

  return {
    txSignature: result.txSignature,
    solscanUrl: result.solscanUrl,
    template: result.template,
  };
}

/** Run the on-chain verification (Step 3 — breathing) using stored template. */
export async function verifyOnChain(
  frames: ImageData[],
  provider: IProvider,
  publicKey: PublicKey
): Promise<OnChainVerification | null> {
  if (!isOnChainEnabled()) return null;
  const stored = loadTemplate();
  if (!stored) return null;

  const { BreathPrint } = await import("@repo/sdk");
  const { AnchorProvider } = await import("@coral-xyz/anchor");
  const { Connection } = await import("@solana/web3.js");
  const idl = (await import("./breathprint-idl.json")).default;

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";
  const rpcUrl = `https://${network}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const connection = new Connection(rpcUrl, "confirmed");

  const wallet = web3authWallet(provider, publicKey);
  const anchorProvider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const sdk = new BreathPrint({
    provider: anchorProvider,
    idl,
    heliusApiKey: HELIUS_API_KEY,
    circuits: {
      registration: { wasm: CIRCUIT_REG_WASM, zkey: CIRCUIT_REG_ZKEY },
      verification: { wasm: CIRCUIT_VER_WASM, zkey: CIRCUIT_VER_ZKEY },
    },
    biometrics: { arcfaceModelUrl: ARCFACE_MODEL_URL },
  });
  await sdk.init();
  const result = await sdk.verify(frames, stored);

  return {
    txSignature: result.txSignature,
    solscanUrl: result.solscanUrl,
    similarity: result.similarity,
  };
}

// ── Internal: minimal Anchor wallet wrapper around Web3Auth provider ─

function web3authWallet(provider: IProvider, publicKey: PublicKey) {
  return {
    publicKey,
    async signTransaction<T>(tx: T): Promise<T> {
      const { SolanaWallet } = await import("@web3auth/solana-provider");
      const sw = new SolanaWallet(provider);
      // SolanaWallet.signTransaction handles both legacy and versioned txs.
      return (await sw.signTransaction(tx as never)) as T;
    },
    async signAllTransactions<T>(txs: T[]): Promise<T[]> {
      const { SolanaWallet } = await import("@web3auth/solana-provider");
      const sw = new SolanaWallet(provider);
      return (await sw.signAllTransactions(txs as never)) as T[];
    },
  };
}
