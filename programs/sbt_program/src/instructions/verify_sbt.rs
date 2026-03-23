use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<VerifySbt>) -> Result<()> {
    let record = &ctx.accounts.sbt_record;
    require!(!record.revoked, SbtError::SbtRevoked);
    require_keys_eq!(record.owner, ctx.accounts.owner.key(), SbtError::NotOwner);
    msg!("SBT valid. Owner: {} Type: {} Collection: {:?}",
        record.owner, record.sbt_type, record.collection_id);
    Ok(())
}

#[derive(Accounts)]
#[instruction(collection_id: [u8; 32], mission_index: u8)]
pub struct VerifySbt<'info> {
    /// CHECK: compared against sbt_record.owner
    pub owner: UncheckedAccount<'info>,

    #[account(
        seeds = [SBT_RECORD_SEED, &collection_id, &[mission_index], owner.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,
}
