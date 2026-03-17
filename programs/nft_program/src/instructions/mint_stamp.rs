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
    types::DataV2,
    ID as METADATA_PROGRAM_ID,
};
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<MintStamp>,
    checkpoint_index: u8,
    name: String,
    symbol: String,
    royalty: u16,
) -> Result<()> {
    require!(name.len() <= 32, NftError::NameTooLong);
    require!(symbol.len() <= 10, NftError::SymbolTooLong);
    require!(royalty <= 10_000, NftError::InvalidRoyalty);
    require!(
        ctx.accounts.rally_config.active,
        NftError::NotActive
    );
    require!(
        checkpoint_index < ctx.accounts.rally_config.total_checkpoints || checkpoint_index == 255,
        NftError::InvalidCheckpointIndex
    );
    require!(
        ctx.accounts.nft_config.authority == ctx.accounts.authority.key(),
        NftError::Unauthorized
    );

    let uri = if checkpoint_index == 255 {
        ctx.accounts.rally_config.uri_complete.clone()
    } else {
        ctx.accounts.rally_config.uri_stamp.clone()
    };

    let rally_id = ctx.accounts.rally_config.rally_id;

    // Mint 1 SPL token
    let cpi_mint = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    token::mint_to(cpi_mint, 1)?;

    // Metaplex metadata
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
            name,
            symbol,
            uri,
            seller_fee_basis_points: royalty,
            creators: None,
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

    let edition_ix = CreateMasterEditionV3 {
        edition: ctx.accounts.master_edition.key(),
        mint: ctx.accounts.mint.key(),
        update_authority: ctx.accounts.authority.key(),
        mint_authority: ctx.accounts.authority.key(),
        payer: ctx.accounts.authority.key(),
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
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.metadata.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ])?;

    // Write StampParticipation
    let now = Clock::get()?.unix_timestamp;
    let participation = &mut ctx.accounts.stamp_participation;
    participation.user = ctx.accounts.recipient.key();
    participation.rally_id = rally_id;
    participation.checkpoint_index = checkpoint_index;
    participation.minted_at = now;
    participation.bump = ctx.bumps.stamp_participation;

    // Write StampRecord
    // Note: owner_at_mint is intentionally absent here. For stamp NFTs, provenance
    // (who received this NFT) is proven by the StampParticipation PDA, which is seeded
    // by (stamp_participation, rally_id, checkpoint_index, recipient). The PDA's existence
    // is itself proof of ownership at mint time, making a redundant owner_at_mint field
    // in StampRecord unnecessary (unlike RwaRecord, which uses a different dedup structure).
    let record = &mut ctx.accounts.stamp_record;
    record.mint = ctx.accounts.mint.key();
    record.rally_id = rally_id;
    record.checkpoint_index = checkpoint_index;
    record.bump = ctx.bumps.stamp_record;

    ctx.accounts.nft_config.nft_count = ctx.accounts.nft_config.nft_count
        .checked_add(1)
        .ok_or(NftError::Overflow)?;

    ctx.accounts.rally_config.participant_count = ctx.accounts.rally_config.participant_count
        .checked_add(1)
        .ok_or(NftError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(checkpoint_index: u8, name: String, symbol: String, royalty: u16)]
pub struct MintStamp<'info> {
    #[account(
        mut,
        seeds = [NFT_CONFIG_SEED, &[1u8]],
        bump = nft_config.bump,
    )]
    pub nft_config: Account<'info, NftConfig>,

    #[account(
        mut,
        seeds = [RALLY_CONFIG_SEED, rally_config.rally_id.as_ref()],
        bump = rally_config.bump,
    )]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + StampParticipation::SPACE,
        seeds = [STAMP_PARTICIPATION_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index], recipient.key().as_ref()],
        bump,
    )]
    pub stamp_participation: Account<'info, StampParticipation>,

    #[account(
        init,
        payer = authority,
        space = 8 + StampRecord::SPACE,
        seeds = [STAMP_RECORD_SEED, mint.key().as_ref()],
        bump,
    )]
    pub stamp_record: Account<'info, StampRecord>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = authority,
        mint::freeze_authority = authority,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: Metaplex metadata PDA -- validated by seeds constraint
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
        constraint = metadata.data_is_empty() @ NftError::MetadataAlreadyExists
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex master edition PDA -- validated by seeds constraint
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
