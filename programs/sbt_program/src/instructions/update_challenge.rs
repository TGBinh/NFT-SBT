use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<UpdateChallenge>, active: bool) -> Result<()> {
    ctx.accounts.challenge_config.active = active;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateChallenge<'info> {
    #[account(
        mut,
        constraint = challenge_config.authority == authority.key() @ SbtError::Unauthorized
    )]
    pub challenge_config: Account<'info, ChallengeConfig>,
    pub authority: Signer<'info>,
}
