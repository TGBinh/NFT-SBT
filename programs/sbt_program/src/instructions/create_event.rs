use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use crate::{errors::SbtError, state::*, token_utils::create_sft_mint};

pub fn handler(
    ctx: Context<CreateEvent>,
    event_id: [u8; 32],
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    require!(name.len() <= 32, SbtError::NameTooLong);
    require!(symbol.len() <= 10, SbtError::SymbolTooLong);
    require!(uri.len() <= 200, SbtError::UriTooLong);
    require_keys_eq!(
        ctx.accounts.sbt_config.authority,
        ctx.accounts.authority.key(),
        SbtError::Unauthorized
    );

    let sbt_type = 1u8;
    let config_bump = ctx.accounts.sbt_config.bump;

    create_sft_mint(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        sbt_type,
        config_bump,
        name.clone(),
        symbol.clone(),
        uri.clone(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let config = &mut ctx.accounts.event_config;
    config.event_id = event_id;
    config.name = name;
    config.symbol = symbol;
    config.uri = uri;
    config.authority = ctx.accounts.authority.key();
    config.participant_count = 0;
    config.active = true;
    config.sft_mint = ctx.accounts.sft_mint.key();
    config.bump = ctx.bumps.event_config;

    Ok(())
}

#[derive(Accounts)]
#[instruction(event_id: [u8; 32])]
pub struct CreateEvent<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[1u8]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + EventConfig::SPACE,
        seeds = [EVENT_CONFIG_SEED, &event_id],
        bump,
    )]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: initialized manually in handler via create_sft_mint
    #[account(mut)]
    pub sft_mint: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
