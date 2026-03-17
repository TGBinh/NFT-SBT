use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::associated_token::AssociatedToken;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod token_utils;

use instructions::*;

declare_id!("51G8WL8HZnib5SyV929K2DyqGEMRn89Bx6nJMitsP2QH");

#[program]
pub mod sbt_program {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, sbt_type: u8) -> Result<()> {
        instructions::initialize_config::handler(ctx, sbt_type)
    }
    pub fn create_event(ctx: Context<CreateEvent>, event_id: [u8; 32], name: String, symbol: String, uri: String) -> Result<()> {
        instructions::create_event::handler(ctx, event_id, name, symbol, uri)
    }
    pub fn update_event(ctx: Context<UpdateEvent>, active: bool) -> Result<()> {
        instructions::update_event::handler(ctx, active)
    }
    pub fn create_challenge(
        ctx: Context<CreateChallenge>,
        challenge_id: [u8; 32],
        name: String,
        symbol: String,
        uri_accepted: String,
        uri_mission: String,
        uri_complete: String,
        total_missions: u8,
    ) -> Result<()> {
        instructions::create_challenge::handler(ctx, challenge_id, name, symbol, uri_accepted, uri_mission, uri_complete, total_missions)
    }
    pub fn update_challenge(ctx: Context<UpdateChallenge>, active: bool) -> Result<()> {
        instructions::update_challenge::handler(ctx, active)
    }
    pub fn mint_human_capital(ctx: Context<MintHumanCapital>, name: String, issuer: String, uri: String) -> Result<()> {
        instructions::mint_human_capital::handler(ctx, name, issuer, uri)
    }
}
