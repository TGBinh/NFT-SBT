use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<TransferAuthority>, _sbt_type: u8, new_authority: Pubkey) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        SbtError::Unauthorized
    );
    ctx.accounts.config.authority = new_authority;
    msg!("Authority transferred to {}", new_authority);
    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump = config.bump,
    )]
    pub config: Account<'info, SbtConfig>,
    pub authority: Signer<'info>,
}
