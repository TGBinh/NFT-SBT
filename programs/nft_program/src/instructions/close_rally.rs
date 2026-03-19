use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<CloseRally>) -> Result<()> {
    require!(!ctx.accounts.rally_config.active, NftError::StillActive);
    msg!("RallyConfig closed. Rally ID: {:?}", ctx.accounts.rally_config.rally_id);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseRally<'info> {
    #[account(
        mut,
        constraint = rally_config.authority == authority.key() @ NftError::Unauthorized,
        close = authority,
    )]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
}
