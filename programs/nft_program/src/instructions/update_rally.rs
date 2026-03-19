use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<UpdateRally>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri_stamp: Option<String>,
    uri_complete: Option<String>,
) -> Result<()> {
    if let Some(n) = name {
        require!(n.len() <= 32, NftError::NameTooLong);
        ctx.accounts.rally_config.name = n;
    }
    if let Some(s) = symbol {
        require!(s.len() <= 10, NftError::SymbolTooLong);
        ctx.accounts.rally_config.symbol = s;
    }
    if let Some(u) = uri_stamp {
        require!(u.len() <= 200, NftError::UriTooLong);
        ctx.accounts.rally_config.uri_stamp = u;
    }
    if let Some(u) = uri_complete {
        require!(u.len() <= 200, NftError::UriTooLong);
        ctx.accounts.rally_config.uri_complete = u;
    }
    ctx.accounts.rally_config.active = active;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateRally<'info> {
    #[account(
        mut,
        constraint = rally_config.authority == authority.key() @ NftError::Unauthorized
    )]
    pub rally_config: Account<'info, RallyConfig>,
    pub authority: Signer<'info>,
}
