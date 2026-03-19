use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<CloseChallenge>) -> Result<()> {
    require!(!ctx.accounts.challenge_config.active, SbtError::StillActive);
    msg!("ChallengeConfig closed. Challenge ID: {:?}", ctx.accounts.challenge_config.challenge_id);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseChallenge<'info> {
    #[account(
        mut,
        constraint = challenge_config.authority == authority.key() @ SbtError::Unauthorized,
        close = authority,
    )]
    pub challenge_config: Account<'info, ChallengeConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
