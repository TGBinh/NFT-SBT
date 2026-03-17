use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<UpdateRally>, active: bool) -> Result<()> {
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
