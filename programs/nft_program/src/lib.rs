use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Hd9Bnkfs4ib9wV71fi8ica9skTZQ1ZciWe4RrhYP5mVY");

#[program]
pub mod nft_program {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, collection_type: u8) -> Result<()> {
        instructions::initialize_config::handler(ctx, collection_type)
    }

    pub fn create_rally(
        ctx: Context<CreateRally>,
        rally_id: [u8; 32],
        name: String,
        symbol: String,
        uri_stamp: String,
        uri_complete: String,
        total_checkpoints: u8,
    ) -> Result<()> {
        instructions::create_rally::handler(ctx, rally_id, name, symbol, uri_stamp, uri_complete, total_checkpoints)
    }

    pub fn update_rally(ctx: Context<UpdateRally>, active: bool) -> Result<()> {
        instructions::update_rally::handler(ctx, active)
    }

    pub fn mint_rwa(
        ctx: Context<MintRwa>,
        name: String,
        symbol: String,
        uri: String,
        royalty: u16,
        challenge_id: [u8; 32],
    ) -> Result<()> {
        instructions::mint_rwa::handler(ctx, name, symbol, uri, royalty, challenge_id)
    }

    pub fn mint_stamp(
        ctx: Context<MintStamp>,
        checkpoint_index: u8,
        name: String,
        symbol: String,
        royalty: u16,
    ) -> Result<()> {
        instructions::mint_stamp::handler(ctx, checkpoint_index, name, symbol, royalty)
    }
}
