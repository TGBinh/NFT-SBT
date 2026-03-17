use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount},
};
use mpl_token_metadata::{
    instructions::{
        CreateMasterEditionV3, CreateMasterEditionV3InstructionArgs,
        CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs,
    },
    types::{Creator, DataV2},
    ID as METADATA_PROGRAM_ID,
};
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<MintRwa>,
    name: String,
    symbol: String,
    uri: String,
    royalty: u16,
    challenge_id: [u8; 32],
) -> Result<()> {
    require!(name.len() <= 32, NftError::NameTooLong);
    require!(symbol.len() <= 10, NftError::SymbolTooLong);
    require!(uri.len() <= 200, NftError::UriTooLong);
    require!(royalty <= 10_000, NftError::InvalidRoyalty);
    require!(
        ctx.accounts.nft_config.authority == ctx.accounts.authority.key(),
        NftError::Unauthorized
    );

    // Mint 1 SPL token
    let cpi_mint = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    token::mint_to(cpi_mint, 1)?;

    // Metaplex metadata
    let creators = vec![Creator {
        address: ctx.accounts.authority.key(),
        verified: true,
        share: 100,
    }];
    let metadata_ix = CreateMetadataAccountV3 {
        metadata: ctx.accounts.metadata.key(),
        mint: ctx.accounts.mint.key(),
        mint_authority: ctx.accounts.authority.key(),
        payer: ctx.accounts.payer.key(),
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
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ])?;

    let edition_ix = CreateMasterEditionV3 {
        edition: ctx.accounts.master_edition.key(),
        mint: ctx.accounts.mint.key(),
        update_authority: ctx.accounts.authority.key(),
        mint_authority: ctx.accounts.authority.key(),
        payer: ctx.accounts.payer.key(),
        metadata: ctx.accounts.metadata.key(),
        token_program: ctx.accounts.token_program.key(),
        system_program: ctx.accounts.system_program.key(),
        rent: Some(ctx.accounts.rent.key()),
    }.instruction(CreateMasterEditionV3InstructionArgs { max_supply: Some(0) });
    invoke(&edition_ix, &[
        ctx.accounts.master_edition.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.metadata.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ])?;

    // Write RwaIssuance (dedup guard)
    let now = Clock::get()?.unix_timestamp;
    let issuance = &mut ctx.accounts.rwa_issuance;
    issuance.challenge_id = challenge_id;
    issuance.user = ctx.accounts.recipient.key();
    issuance.minted_at = now;
    issuance.bump = ctx.bumps.rwa_issuance;

    // Write RwaRecord
    let record = &mut ctx.accounts.rwa_record;
    record.mint = ctx.accounts.mint.key();
    record.owner_at_mint = ctx.accounts.recipient.key();
    record.challenge_id = challenge_id;
    record.is_used = false;
    record.used_at = 0;
    record.bump = ctx.bumps.rwa_record;

    ctx.accounts.nft_config.nft_count = ctx.accounts.nft_config.nft_count
        .checked_add(1)
        .ok_or(NftError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String, royalty: u16, challenge_id: [u8; 32])]
pub struct MintRwa<'info> {
    #[account(
        mut,
        seeds = [NFT_CONFIG_SEED, &[0u8]],
        bump = nft_config.bump,
    )]
    pub nft_config: Account<'info, NftConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RwaIssuance::SPACE,
        seeds = [RWA_ISSUANCE_SEED, &challenge_id, recipient.key().as_ref()],
        bump
    )]
    pub rwa_issuance: Account<'info, RwaIssuance>,

    #[account(
        init,
        payer = payer,
        space = 8 + RwaRecord::SPACE,
        seeds = [RWA_RECORD_SEED, mint.key().as_ref()],
        bump
    )]
    pub rwa_record: Account<'info, RwaRecord>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = authority,
        mint::freeze_authority = authority,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub token_account: Account<'info, TokenAccount>,

    /// CHECK: Metaplex PDA -- validated by seeds constraint
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
        constraint = metadata.data_is_empty() @ NftError::MetadataAlreadyExists
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex PDA -- validated by seeds constraint
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref(), b"edition"],
        bump,
        seeds::program = token_metadata_program.key()
    )]
    pub master_edition: UncheckedAccount<'info>,

    /// CHECK: Metaplex program -- validated by address constraint
    #[account(address = METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
