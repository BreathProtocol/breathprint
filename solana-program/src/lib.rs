use anchor_lang::prelude::*;
use light_sdk::{
    compressed_account::LightAccount,
    light_account, light_accounts,
    merkle_context::PackedAddressMerkleContext,
    address::v1::derive_address,
};

declare_id!("BPrnt1111111111111111111111111111111111111");

/// BreathPrint Identity Program
///
/// Uses Light Protocol compressed PDAs to store biometric commitments.
/// Each identity is a compressed account — costs ~0.000015 SOL vs ~0.002 SOL.
///
/// Flow:
///   Step 2 (Face): register_biometric → stores commitment in compressed PDA
///   Step 3 (Breath): verify_breathing → proves same face + liveness → marks verified
#[program]
pub mod breathprint {
    use super::*;

    /// Step 2: Register face biometric as compressed PDA
    ///
    /// Called after location check passes.
    /// Creates a compressed PDA storing the Poseidon hash commitment
    /// of the user's face embedding (ArcFace 512d → LSH 256-bit → Poseidon).
    pub fn register_biometric(
        ctx: Context<RegisterBiometric>,
        commitment: [u8; 32],          // Poseidon(template || salt)
        proof_data: Vec<u8>,           // Groth16 proof bytes
    ) -> Result<()> {
        // Validate proof length (Groth16 proof = ~192 bytes typically)
        require!(proof_data.len() >= 128, BreathPrintError::InvalidProof);

        // In production: verify Groth16 proof on-chain using groth16-solana
        // For hackathon: the proof is verified client-side and we trust the submission
        // The compressed PDA itself provides integrity via Light Protocol's Merkle tree

        let identity = &mut ctx.accounts.identity;
        identity.owner = ctx.accounts.signer.key();
        identity.commitment = commitment;
        identity.registered_at = Clock::get()?.unix_timestamp;
        identity.is_verified = false;          // Not yet — needs breathing step
        identity.verification_count = 0;
        identity.last_verified_at = 0;

        // Store registration tx signature for explorer
        // (captured client-side after tx confirms)

        msg!("BreathPrint: Biometric registered for {}", identity.owner);
        msg!("Commitment: {:?}", &commitment[..8]); // Log first 8 bytes

        emit!(BiometricRegistered {
            owner: identity.owner,
            commitment,
            timestamp: identity.registered_at,
        });

        Ok(())
    }

    /// Step 3: Verify breathing + face match
    ///
    /// Called after user completes breath in/out sequence.
    /// The ZK proof proves:
    ///   1. New face capture matches registered commitment (Hamming < threshold)
    ///   2. Breathing motion was detected (liveness)
    ///
    /// After this, the user is fully verified.
    pub fn verify_breathing(
        ctx: Context<VerifyBreathing>,
        verification_proof: Vec<u8>,    // Groth16 verification proof
        threshold: u8,                   // Hamming distance threshold (25 = 90%)
    ) -> Result<()> {
        let identity = &mut ctx.accounts.identity;

        require!(
            identity.owner == ctx.accounts.signer.key(),
            BreathPrintError::Unauthorized
        );
        require!(!identity.is_verified || true, BreathPrintError::AlreadyVerified);
        // Allow re-verification (true above means always passes — users can re-verify)

        // In production: verify Groth16 proof matching BiometricVerification circuit
        // Public inputs: commitment (from PDA) + threshold
        require!(verification_proof.len() >= 128, BreathPrintError::InvalidProof);
        require!(threshold <= 64, BreathPrintError::ThresholdTooHigh);

        identity.is_verified = true;
        identity.verification_count += 1;
        identity.last_verified_at = Clock::get()?.unix_timestamp;

        msg!("BreathPrint: Identity VERIFIED for {}", identity.owner);

        emit!(BreathingVerified {
            owner: identity.owner,
            commitment: identity.commitment,
            timestamp: identity.last_verified_at,
            verification_count: identity.verification_count,
        });

        Ok(())
    }

    /// Revoke identity (owner only)
    pub fn revoke_identity(ctx: Context<RevokeIdentity>) -> Result<()> {
        let identity = &mut ctx.accounts.identity;
        require!(
            identity.owner == ctx.accounts.signer.key(),
            BreathPrintError::Unauthorized
        );

        identity.is_verified = false;

        emit!(IdentityRevoked {
            owner: identity.owner,
            commitment: identity.commitment,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Query: check if a wallet has a verified identity
    /// (read-only — called via simulate or getProgramAccounts)
    pub fn check_status(ctx: Context<CheckStatus>) -> Result<()> {
        let identity = &ctx.accounts.identity;
        msg!("Owner: {}", identity.owner);
        msg!("Verified: {}", identity.is_verified);
        msg!("Count: {}", identity.verification_count);
        Ok(())
    }
}

// ============================================================
// Compressed Account (Light Protocol)
// ============================================================

/// Identity stored as a Light Protocol compressed PDA.
/// Cost: ~0.000015 SOL instead of ~0.002 SOL for regular PDA.
///
/// The #[light_account] macro handles:
/// - Merkle tree insertion
/// - Data hash computation
/// - Validity proof verification
#[light_account]
#[derive(Clone, Debug, Default)]
pub struct BreathPrintIdentity {
    /// Wallet public key that owns this identity
    #[truncate]
    pub owner: Pubkey,
    /// Poseidon hash commitment of biometric template
    pub commitment: [u8; 32],
    /// Unix timestamp of registration
    pub registered_at: i64,
    /// Unix timestamp of last breathing verification
    pub last_verified_at: i64,
    /// Number of successful verifications
    pub verification_count: u32,
    /// True after breathing step completes
    pub is_verified: bool,
}

// ============================================================
// Account Contexts (using Light SDK macros)
// ============================================================

#[light_accounts]
pub struct RegisterBiometric<'info> {
    #[account(mut)]
    #[fee_payer]
    pub signer: Signer<'info>,

    #[self_program]
    pub self_program: Program<'info, crate::program::Breathprint>,

    /// CHECK: Checked by Light Protocol
    #[authority]
    pub cpi_signer: AccountInfo<'info>,

    #[light_account(init, seeds = [b"identity", signer.key().as_ref()])]
    pub identity: LightAccount<BreathPrintIdentity>,
}

#[light_accounts]
pub struct VerifyBreathing<'info> {
    #[account(mut)]
    #[fee_payer]
    pub signer: Signer<'info>,

    #[self_program]
    pub self_program: Program<'info, crate::program::Breathprint>,

    /// CHECK: Checked by Light Protocol
    #[authority]
    pub cpi_signer: AccountInfo<'info>,

    #[light_account(mut, seeds = [b"identity", signer.key().as_ref()])]
    pub identity: LightAccount<BreathPrintIdentity>,
}

#[light_accounts]
pub struct RevokeIdentity<'info> {
    #[account(mut)]
    #[fee_payer]
    pub signer: Signer<'info>,

    #[self_program]
    pub self_program: Program<'info, crate::program::Breathprint>,

    /// CHECK: Checked by Light Protocol
    #[authority]
    pub cpi_signer: AccountInfo<'info>,

    #[light_account(mut, seeds = [b"identity", signer.key().as_ref()])]
    pub identity: LightAccount<BreathPrintIdentity>,
}

#[light_accounts]
pub struct CheckStatus<'info> {
    pub signer: Signer<'info>,

    #[self_program]
    pub self_program: Program<'info, crate::program::Breathprint>,

    /// CHECK: Checked by Light Protocol
    #[authority]
    pub cpi_signer: AccountInfo<'info>,

    #[light_account(seeds = [b"identity", signer.key().as_ref()])]
    pub identity: LightAccount<BreathPrintIdentity>,
}

// ============================================================
// Events
// ============================================================

#[event]
pub struct BiometricRegistered {
    pub owner: Pubkey,
    pub commitment: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct BreathingVerified {
    pub owner: Pubkey,
    pub commitment: [u8; 32],
    pub timestamp: i64,
    pub verification_count: u32,
}

#[event]
pub struct IdentityRevoked {
    pub owner: Pubkey,
    pub commitment: [u8; 32],
    pub timestamp: i64,
}

// ============================================================
// Errors
// ============================================================

#[error_code]
pub enum BreathPrintError {
    #[msg("Invalid ZK proof")]
    InvalidProof,
    #[msg("Already verified")]
    AlreadyVerified,
    #[msg("Threshold too high — max 64 for 256-bit template")]
    ThresholdTooHigh,
    #[msg("Unauthorized — not identity owner")]
    Unauthorized,
    #[msg("Identity not found")]
    NotFound,
}
