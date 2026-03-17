use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

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

    let cfg = &mut ctx.accounts.event_config;
    cfg.event_id = event_id;
    cfg.name = name;
    cfg.symbol = symbol;
    cfg.uri = uri;
    cfg.authority = ctx.accounts.authority.key();
    cfg.participant_count = 0;
    cfg.active = true;
    cfg.bump = ctx.bumps.event_config;
    Ok(())
}

#[derive(Accounts)]
#[instruction(event_id: [u8; 32])]
pub struct CreateEvent<'info> {
    #[account(
        seeds = [SBT_CONFIG_SEED, &[1u8]],
        bump = sbt_config.bump,
        constraint = sbt_config.authority == authority.key() @ SbtError::Unauthorized
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + EventConfig::SPACE,
        seeds = [EVENT_CONFIG_SEED, &event_id],
        bump
    )]
    pub event_config: Account<'info, EventConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
