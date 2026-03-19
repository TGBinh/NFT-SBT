use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(
    ctx: Context<UpdateEvent>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri: Option<String>,
) -> Result<()> {
    if let Some(n) = name {
        require!(n.len() <= 32, SbtError::NameTooLong);
        ctx.accounts.event_config.name = n;
    }
    if let Some(s) = symbol {
        require!(s.len() <= 10, SbtError::SymbolTooLong);
        ctx.accounts.event_config.symbol = s;
    }
    if let Some(u) = uri {
        require!(u.len() <= 200, SbtError::UriTooLong);
        ctx.accounts.event_config.uri = u;
    }
    ctx.accounts.event_config.active = active;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateEvent<'info> {
    #[account(
        mut,
        constraint = event_config.authority == authority.key() @ SbtError::Unauthorized
    )]
    pub event_config: Account<'info, EventConfig>,
    pub authority: Signer<'info>,
}
