use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(
    ctx: Context<CreateChallenge>,
    challenge_id: [u8; 32],
    name: String,
    symbol: String,
    uri_accepted: String,
    uri_mission: String,
    uri_complete: String,
    total_missions: u8,
) -> Result<()> {
    require!(name.len() <= 32, SbtError::NameTooLong);
    require!(symbol.len() <= 10, SbtError::SymbolTooLong);
    require!(uri_accepted.len() <= 200, SbtError::UriTooLong);
    require!(uri_mission.len() <= 200, SbtError::UriTooLong);
    require!(uri_complete.len() <= 200, SbtError::UriTooLong);
    require!(total_missions >= 1 && total_missions <= 254, SbtError::InvalidTotalMissions);

    let cfg = &mut ctx.accounts.challenge_config;
    cfg.challenge_id = challenge_id;
    cfg.name = name;
    cfg.symbol = symbol;
    cfg.uri_accepted = uri_accepted;
    cfg.uri_mission = uri_mission;
    cfg.uri_complete = uri_complete;
    cfg.total_missions = total_missions;
    cfg.authority = ctx.accounts.authority.key();
    cfg.participant_count = 0;
    cfg.active = true;
    cfg.bump = ctx.bumps.challenge_config;
    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct CreateChallenge<'info> {
    #[account(
        seeds = [SBT_CONFIG_SEED, &[2u8]],
        bump = sbt_config.bump,
        constraint = sbt_config.authority == authority.key() @ SbtError::Unauthorized
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + ChallengeConfig::SPACE,
        seeds = [CHALLENGE_CONFIG_SEED, &challenge_id],
        bump
    )]
    pub challenge_config: Account<'info, ChallengeConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
