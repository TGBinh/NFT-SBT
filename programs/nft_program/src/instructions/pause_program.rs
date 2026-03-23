use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<PauseProgram>, collection_type: u8, paused: bool) -> Result<()> {
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);
    ctx.accounts.nft_config.paused = paused;
    msg!("NftConfig type={} paused={}", collection_type, paused);
    Ok(())
}

#[derive(Accounts)]
#[instruction(collection_type: u8)]
pub struct PauseProgram<'info> {
    #[account(
        mut,
        seeds = [NFT_CONFIG_SEED, &[collection_type]],
        bump = nft_config.bump,
    )]
    pub nft_config: Account<'info, NftConfig>,
    pub authority: Signer<'info>,
}
