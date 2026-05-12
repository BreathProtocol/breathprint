import { supabase } from "./auth";

/**
 * Record an attestation into the shared Supabase table. The Vertebra Atlas
 * Explorer (vertebra.breath.id/explorer) reads from this table to display
 * proofs after a verify.breath.id run completes.
 *
 * Until the Anchor program emits real on-chain tx signatures, the caller
 * mints a base58-encoded random 64-byte string (same shape as a Solana
 * signature) and writes it here. Once the on-chain pipeline is live,
 * `tx_signature` will be the actual signature returned by the program
 * and the rest of this flow stays unchanged.
 */
export interface AttestationInput {
  walletAddress: string;
  txSignature: string;
  attestationType: "breath" | "face" | "document" | "geolocation" | "breathprint";
  cluster?: "devnet" | "mainnet-beta" | "testnet";
  slot?: number | null;
  metadata?: Record<string, unknown>;
}

export async function recordAttestation(input: AttestationInput) {
  const { error, data } = await supabase
    .from("attestations")
    .insert({
      wallet_address: input.walletAddress,
      tx_signature: input.txSignature,
      attestation_type: input.attestationType,
      cluster: input.cluster ?? "devnet",
      slot: input.slot ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    console.error("[attestations] insert failed:", error);
    throw error;
  }
  return data;
}
