use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use spl_token_metadata_interface::state::Field;
use crate::{errors::SbtError, state::*, token_utils::update_sft_metadata_field};

pub fn handler(
    ctx: Context<UpdateEvent>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri: Option<String>,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.event_config.authority,
        ctx.accounts.authority.key(),
        SbtError::Unauthorized
    );

    let config = &mut ctx.accounts.event_config;
    config.active = active;

    let sbt_type = 1u8;
    let config_bump = ctx.accounts.sbt_config.bump;

    if let Some(new_name) = name {
        require!(new_name.len() <= 32, SbtError::NameTooLong);
        update_sft_metadata_field(
            &ctx.accounts.sft_mint.to_account_info(),
            &ctx.accounts.sbt_config.to_account_info(),
            sbt_type, config_bump,
            Field::Name, new_name.clone(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        config.name = new_name;
    }
    if let Some(new_symbol) = symbol {
        require!(new_symbol.len() <= 10, SbtError::SymbolTooLong);
        update_sft_metadata_field(
            &ctx.accounts.sft_mint.to_account_info(),
            &ctx.accounts.sbt_config.to_account_info(),
            sbt_type, config_bump,
            Field::Symbol, new_symbol.clone(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        config.symbol = new_symbol;
    }
    if let Some(new_uri) = uri {
        require!(new_uri.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(
            &ctx.accounts.sft_mint.to_account_info(),
            &ctx.accounts.sbt_config.to_account_info(),
            sbt_type, config_bump,
            Field::Uri, new_uri.clone(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        config.uri = new_uri;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateEvent<'info> {
    #[account(
        seeds = [SBT_CONFIG_SEED, &[1u8]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: SFT mint for this event — validated via event_config.sft_mint
    #[account(
        mut,
        constraint = sft_mint.key() == event_config.sft_mint @ SbtError::MintNotCreated
    )]
    pub sft_mint: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
    pub token_2022_program: Program<'info, Token2022>,
}
