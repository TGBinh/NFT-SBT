use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<PauseProgram>, sbt_type: u8, paused: bool) -> Result<()> {
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    ctx.accounts.sbt_config.paused = paused;
    msg!("SbtConfig type={} paused={}", sbt_type, paused);
    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8)]
pub struct PauseProgram<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,
    pub authority: Signer<'info>,
}
