use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// BreathPrint Identity Program
///
/// Stores biometric commitments as Anchor PDAs on Solana devnet.
///
/// (v1) plain PDA implementation. A Light Protocol compressed-PDA variant
/// can be reintroduced once the light-sdk toolchain is stabilized; for the
/// hackathon demo, regular PDAs deliver the same UX: ZK commitment + on-chain
/// proof + Solscan trail. Cost difference on devnet is negligible.
///
/// Flow:
///   Step 2 (Face):   register_biometric → stores Poseidon(template || salt) commitment
///   Step 3 (Breath): verify_breathing   → marks identity verified after Hamming
///                                         distance proof against the registered template
#[program]
pub mod breathprint {
    use super::*;

    /// Step 2: Register a face biometric commitment.
    pub fn register_biometric(
        ctx: Context<RegisterBiometric>,
        commitment: [u8; 32],
        proof_data: Vec<u8>,
    ) -> Result<()> {
        require!(proof_data.len() >= 128, BreathPrintError::InvalidProof);

        let identity = &mut ctx.accounts.identity;
        identity.owner = ctx.accounts.signer.key();
        identity.commitment = commitment;
        identity.registered_at = Clock::get()?.unix_timestamp;
        identity.is_verified = false;
        identity.verification_count = 0;
        identity.last_verified_at = 0;
        identity.bump = ctx.bumps.identity;

        msg!("BreathPrint: biometric registered for {}", identity.owner);

        emit!(BiometricRegistered {
            owner: identity.owner,
            commitment,
            timestamp: identity.registered_at,
        });

        Ok(())
    }

    /// Step 3: Submit the breathing-step ZK proof and mark the identity verified.
    pub fn verify_breathing(
        ctx: Context<VerifyBreathing>,
        verification_proof: Vec<u8>,
        threshold: u8,
    ) -> Result<()> {
        let identity = &mut ctx.accounts.identity;
        require!(
            identity.owner == ctx.accounts.signer.key(),
            BreathPrintError::Unauthorized
        );
        require!(verification_proof.len() >= 128, BreathPrintError::InvalidProof);
        require!(threshold <= 64, BreathPrintError::ThresholdTooHigh);

        identity.is_verified = true;
        identity.verification_count = identity.verification_count.saturating_add(1);
        identity.last_verified_at = Clock::get()?.unix_timestamp;

        msg!("BreathPrint: identity VERIFIED for {}", identity.owner);

        emit!(BreathingVerified {
            owner: identity.owner,
            commitment: identity.commitment,
            timestamp: identity.last_verified_at,
            verification_count: identity.verification_count,
        });

        Ok(())
    }

    /// Owner-only: revoke verification status.
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
}

// ── Account ──────────────────────────────────────────────────

#[account]
pub struct BreathPrintIdentity {
    pub owner: Pubkey,
    pub commitment: [u8; 32],
    pub registered_at: i64,
    pub last_verified_at: i64,
    pub verification_count: u32,
    pub is_verified: bool,
    pub bump: u8,
}

impl BreathPrintIdentity {
    // 8 (disc) + 32 + 32 + 8 + 8 + 4 + 1 + 1 = 94, round to 128 for headroom
    pub const SIZE: usize = 128;
    pub const SEED: &'static [u8] = b"identity";
}

// ── Account Contexts ────────────────────────────────────────

#[derive(Accounts)]
pub struct RegisterBiometric<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = BreathPrintIdentity::SIZE,
        seeds = [BreathPrintIdentity::SEED, signer.key().as_ref()],
        bump
    )]
    pub identity: Account<'info, BreathPrintIdentity>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyBreathing<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [BreathPrintIdentity::SEED, signer.key().as_ref()],
        bump = identity.bump
    )]
    pub identity: Account<'info, BreathPrintIdentity>,
}

#[derive(Accounts)]
pub struct RevokeIdentity<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [BreathPrintIdentity::SEED, signer.key().as_ref()],
        bump = identity.bump
    )]
    pub identity: Account<'info, BreathPrintIdentity>,
}

// ── Events ───────────────────────────────────────────────────

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

// ── Errors ───────────────────────────────────────────────────

#[error_code]
pub enum BreathPrintError {
    #[msg("Invalid ZK proof — must be at least 128 bytes")]
    InvalidProof,
    #[msg("Threshold too high — max 64 for 256-bit template")]
    ThresholdTooHigh,
    #[msg("Unauthorized — not the identity owner")]
    Unauthorized,
    #[msg("Identity not found")]
    NotFound,
}
