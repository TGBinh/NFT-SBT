use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<VerifySbt>) -> Result<()> {
    let record = &ctx.accounts.sbt_record;
    require!(!record.revoked, SbtError::SbtRevoked);
    require_keys_eq!(record.owner, ctx.accounts.owner.key(), SbtError::NotOwner);
    require_keys_eq!(record.mint, ctx.accounts.mint.key(), SbtError::MintMismatch);
    msg!("SBT valid. Owner: {} Name: {}", record.owner, record.name);
    Ok(())
}

#[derive(Accounts)]
pub struct VerifySbt<'info> {
    /// CHECK: compared against sbt_record.owner
    pub owner: UncheckedAccount<'info>,
    /// CHECK: compared against sbt_record.mint
    pub mint: UncheckedAccount<'info>,
    #[account(
        seeds = [SBT_RECORD_SEED, mint.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,
}
