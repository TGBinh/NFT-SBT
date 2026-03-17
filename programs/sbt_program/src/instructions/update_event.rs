use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<UpdateEvent>, active: bool) -> Result<()> {
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
