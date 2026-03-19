use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<CloseEvent>) -> Result<()> {
    require!(!ctx.accounts.event_config.active, SbtError::StillActive);
    msg!("EventConfig closed. Event ID: {:?}", ctx.accounts.event_config.event_id);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseEvent<'info> {
    #[account(
        mut,
        constraint = event_config.authority == authority.key() @ SbtError::Unauthorized,
        close = authority,
    )]
    pub event_config: Account<'info, EventConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
