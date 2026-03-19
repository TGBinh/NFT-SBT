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

    pub fn update_rally(
        ctx: Context<UpdateRally>,
        active: bool,
        name: Option<String>,
        symbol: Option<String>,
        uri_stamp: Option<String>,
        uri_complete: Option<String>,
    ) -> Result<()> {
        instructions::update_rally::handler(ctx, active, name, symbol, uri_stamp, uri_complete)
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

    pub fn use_rwa(ctx: Context<UseRwa>) -> Result<()> {
        instructions::use_rwa::handler(ctx)
    }
    pub fn transfer_authority(ctx: Context<TransferAuthority>, collection_type: u8, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::handler(ctx, collection_type, new_authority)
    }
    pub fn burn_rwa(ctx: Context<BurnRwa>) -> Result<()> {
        instructions::burn_rwa::handler(ctx)
    }
    pub fn burn_stamp(ctx: Context<BurnStamp>) -> Result<()> {
        instructions::burn_stamp::handler(ctx)
    }
    pub fn close_rally(ctx: Context<CloseRally>) -> Result<()> {
        instructions::close_rally::handler(ctx)
    }
}
