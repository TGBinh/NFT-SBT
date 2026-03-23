use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::{associated_token::AssociatedToken, token::{Mint, Token}};
use mpl_token_metadata::{
    instructions::{CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs},
    types::{Creator, DataV2},
    ID as METADATA_PROGRAM_ID,
};
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<CreateRwaMint>,
    challenge_id: [u8; 32],
    name: String,
    symbol: String,
    uri: String,
    royalty: u16,
) -> Result<()> {
    require!(name.len() <= 32, NftError::NameTooLong);
    require!(symbol.len() <= 10, NftError::SymbolTooLong);
    require!(uri.len() <= 200, NftError::UriTooLong);
    require!(royalty <= 10_000, NftError::InvalidRoyalty);
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);

    let creators = vec![Creator {
        address: ctx.accounts.authority.key(),
        verified: true,
        share: 100,
    }];

    let metadata_ix = CreateMetadataAccountV3 {
        metadata: ctx.accounts.metadata.key(),
        mint: ctx.accounts.mint.key(),
        mint_authority: ctx.accounts.authority.key(),
        payer: ctx.accounts.authority.key(),
        update_authority: (ctx.accounts.authority.key(), true),
        system_program: ctx.accounts.system_program.key(),
        rent: Some(ctx.accounts.rent.key()),
    }.instruction(CreateMetadataAccountV3InstructionArgs {
        data: DataV2 {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            seller_fee_basis_points: royalty,
            creators: Some(creators),
            collection: None,
            uses: None,
        },
        is_mutable: true,
        collection_details: None,
    });

    invoke(&metadata_ix, &[
        ctx.accounts.metadata.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ])?;

    let config = &mut ctx.accounts.rwa_config;
    config.challenge_id = challenge_id;
    config.name = name;
    config.symbol = symbol;
    config.uri = uri;
    config.royalty = royalty;
    config.sft_mint = ctx.accounts.mint.key();
    config.authority = ctx.accounts.authority.key();
    config.participant_count = 0;
    config.active = true;
    config.bump = ctx.bumps.rwa_config;

    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct CreateRwaMint<'info> {
    #[account(seeds = [NFT_CONFIG_SEED, &[0u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + RwaConfig::SPACE,
        seeds = [RWA_CONFIG_SEED, &challenge_id],
        bump,
    )]
    pub rwa_config: Account<'info, RwaConfig>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = authority,
        mint::freeze_authority = authority,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Metaplex metadata PDA
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
        constraint = metadata.data_is_empty() @ NftError::MetadataAlreadyExists
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex program
    #[account(address = METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
