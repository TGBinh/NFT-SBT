use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<CreateRally>,
    rally_id: [u8; 32],
    name: String,
    symbol: String,
    uri_stamp: String,
    uri_complete: String,
    total_checkpoints: u8,
) -> Result<()> {
    require!(name.len() <= 32, NftError::NameTooLong);
    require!(symbol.len() <= 10, NftError::SymbolTooLong);
    require!(uri_stamp.len() <= 200, NftError::UriTooLong);
    require!(uri_complete.len() <= 200, NftError::UriTooLong);
    require!(total_checkpoints >= 1 && total_checkpoints <= 254, NftError::InvalidTotalCheckpoints);

    let cfg = &mut ctx.accounts.rally_config;
    cfg.rally_id = rally_id;
    cfg.name = name;
    cfg.symbol = symbol;
    cfg.uri_stamp = uri_stamp;
    cfg.uri_complete = uri_complete;
    cfg.total_checkpoints = total_checkpoints;
    cfg.authority = ctx.accounts.authority.key();
    cfg.participant_count = 0;
    cfg.active = true;
    cfg.bump = ctx.bumps.rally_config;
    Ok(())
}

#[derive(Accounts)]
#[instruction(rally_id: [u8; 32])]
pub struct CreateRally<'info> {
    #[account(
        seeds = [NFT_CONFIG_SEED, &[1u8]],
        bump = nft_config.bump,
        constraint = nft_config.authority == authority.key() @ NftError::Unauthorized
    )]
    pub nft_config: Account<'info, NftConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + RallyConfig::SPACE,
        seeds = [RALLY_CONFIG_SEED, &rally_id],
        bump
    )]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
