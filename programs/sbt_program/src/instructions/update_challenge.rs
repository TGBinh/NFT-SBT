use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(
    ctx: Context<UpdateChallenge>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri_accepted: Option<String>,
    uri_mission: Option<String>,
    uri_complete: Option<String>,
) -> Result<()> {
    if let Some(n) = name {
        require!(n.len() <= 32, SbtError::NameTooLong);
        ctx.accounts.challenge_config.name = n;
    }
    if let Some(s) = symbol {
        require!(s.len() <= 10, SbtError::SymbolTooLong);
        ctx.accounts.challenge_config.symbol = s;
    }
    if let Some(u) = uri_accepted {
        require!(u.len() <= 200, SbtError::UriTooLong);
        ctx.accounts.challenge_config.uri_accepted = u;
    }
    if let Some(u) = uri_mission {
        require!(u.len() <= 200, SbtError::UriTooLong);
        ctx.accounts.challenge_config.uri_mission = u;
    }
    if let Some(u) = uri_complete {
        require!(u.len() <= 200, SbtError::UriTooLong);
        ctx.accounts.challenge_config.uri_complete = u;
    }
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
