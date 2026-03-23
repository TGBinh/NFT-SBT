use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use spl_token_metadata_interface::state::Field;
use crate::{errors::SbtError, state::*, token_utils::update_sft_metadata_field};

pub fn handler(
    ctx: Context<UpdateChallenge>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri_accepted: Option<String>,
    uri_mission: Option<String>,
    uri_complete: Option<String>,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.challenge_config.authority,
        ctx.accounts.authority.key(),
        SbtError::Unauthorized
    );

    let config = &mut ctx.accounts.challenge_config;
    config.active = active;

    let bump_2 = ctx.accounts.sbt_config_accepted.bump;
    let bump_3 = ctx.accounts.sbt_config_mission.bump;

    if let Some(n) = name {
        require!(n.len() <= 32, SbtError::NameTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_accepted_mint.to_account_info(), &ctx.accounts.sbt_config_accepted.to_account_info(), 2, bump_2, Field::Name, format!("{} Accepted", n), &ctx.accounts.token_2022_program.to_account_info())?;
        update_sft_metadata_field(&ctx.accounts.sft_mission_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Name, format!("{} Mission", n), &ctx.accounts.token_2022_program.to_account_info())?;
        update_sft_metadata_field(&ctx.accounts.sft_complete_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Name, format!("{} Complete", n), &ctx.accounts.token_2022_program.to_account_info())?;
        config.name = n;
    }
    if let Some(s) = symbol {
        require!(s.len() <= 10, SbtError::SymbolTooLong);
        config.symbol = s;
    }
    if let Some(u) = uri_accepted {
        require!(u.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_accepted_mint.to_account_info(), &ctx.accounts.sbt_config_accepted.to_account_info(), 2, bump_2, Field::Uri, u.clone(), &ctx.accounts.token_2022_program.to_account_info())?;
        config.uri_accepted = u;
    }
    if let Some(u) = uri_mission {
        require!(u.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_mission_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Uri, u.clone(), &ctx.accounts.token_2022_program.to_account_info())?;
        config.uri_mission = u;
    }
    if let Some(u) = uri_complete {
        require!(u.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_complete_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Uri, u.clone(), &ctx.accounts.token_2022_program.to_account_info())?;
        config.uri_complete = u;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateChallenge<'info> {
    #[account(seeds = [SBT_CONFIG_SEED, &[2u8]], bump = sbt_config_accepted.bump)]
    pub sbt_config_accepted: Account<'info, SbtConfig>,

    #[account(seeds = [SBT_CONFIG_SEED, &[3u8]], bump = sbt_config_mission.bump)]
    pub sbt_config_mission: Account<'info, SbtConfig>,

    #[account(mut)]
    pub challenge_config: Account<'info, ChallengeConfig>,

    /// CHECK: validated via challenge_config.sft_accepted_mint
    #[account(mut, constraint = sft_accepted_mint.key() == challenge_config.sft_accepted_mint @ SbtError::MintNotCreated)]
    pub sft_accepted_mint: UncheckedAccount<'info>,

    /// CHECK: validated via challenge_config.sft_mission_mint
    #[account(mut, constraint = sft_mission_mint.key() == challenge_config.sft_mission_mint @ SbtError::MintNotCreated)]
    pub sft_mission_mint: UncheckedAccount<'info>,

    /// CHECK: validated via challenge_config.sft_complete_mint
    #[account(mut, constraint = sft_complete_mint.key() == challenge_config.sft_complete_mint @ SbtError::MintNotCreated)]
    pub sft_complete_mint: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
    pub token_2022_program: Program<'info, Token2022>,
}
