use anchor_lang::prelude::*;

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
}
