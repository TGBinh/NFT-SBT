use anchor_lang::prelude::*;
use crate::state::*;

pub fn handler(ctx: Context<InitializeConfig>, collection_type: u8) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.collection_type = collection_type;
    config.nft_count = 0;
    config.paused = false;
    config.bump = ctx.bumps.config;
    msg!("NftConfig initialized. Type: {} Authority: {}", collection_type, config.authority);
    Ok(())
}

#[derive(Accounts)]
#[instruction(collection_type: u8)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + NftConfig::SPACE,
        seeds = [NFT_CONFIG_SEED, &[collection_type]],
        bump
    )]
    pub config: Account<'info, NftConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
