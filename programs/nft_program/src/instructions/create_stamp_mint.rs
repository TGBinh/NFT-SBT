use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token::{Mint, Token};
use mpl_token_metadata::{
    instructions::{CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs},
    types::DataV2,
    ID as METADATA_PROGRAM_ID,
};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<CreateStampMint>, checkpoint_index: u8) -> Result<()> {
    require!(ctx.accounts.rally_config.active, NftError::NotActive);
    require!(
        checkpoint_index < ctx.accounts.rally_config.total_checkpoints || checkpoint_index == 255,
        NftError::InvalidCheckpointIndex
    );
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);

    let uri = if checkpoint_index == 255 {
        ctx.accounts.rally_config.uri_complete.clone()
    } else {
        ctx.accounts.rally_config.uri_stamp.clone()
    };
    let name = if checkpoint_index == 255 {
        format!("{} Complete", ctx.accounts.rally_config.name)
    } else {
        format!("{} #{}", ctx.accounts.rally_config.name, checkpoint_index + 1)
    };

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
            symbol: ctx.accounts.rally_config.symbol.clone(),
            uri,
            seller_fee_basis_points: 0,
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

    let cp = &mut ctx.accounts.checkpoint_mint_account;
    cp.rally_id = ctx.accounts.rally_config.rally_id;
    cp.checkpoint_index = checkpoint_index;
    cp.sft_mint = ctx.accounts.mint.key();
    cp.bump = ctx.bumps.checkpoint_mint_account;

    Ok(())
}

#[derive(Accounts)]
#[instruction(checkpoint_index: u8)]
pub struct CreateStampMint<'info> {
    #[account(seeds = [NFT_CONFIG_SEED, &[1u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(seeds = [RALLY_CONFIG_SEED, rally_config.rally_id.as_ref()], bump = rally_config.bump)]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + CheckpointMint::SPACE,
        seeds = [CHECKPOINT_MINT_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index]],
        bump,
    )]
    pub checkpoint_mint_account: Account<'info, CheckpointMint>,

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
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
