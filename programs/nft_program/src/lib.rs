use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer, Burn},
};
use mpl_token_metadata::{
    instructions::{
        CreateMasterEditionV3, CreateMasterEditionV3InstructionArgs,
        CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs,
    },
    types::{Creator, DataV2},
    ID as METADATA_PROGRAM_ID,
};

declare_id!("Hd9Bnkfs4ib9wV71fi8ica9skTZQ1ZciWe4RrhYP5mVY");

// =============================================================================
// CONSTANTS
// =============================================================================

const CONFIG_SEED: &[u8] = b"nft_config";

// =============================================================================
// PROGRAM
// =============================================================================

#[program]
pub mod nft_program {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.bump = ctx.bumps.config;
        config.nft_count = 0;
        msg!("NFT Config initialized. Authority: {}", config.authority);
        Ok(())
    }

    pub fn mint_nft(
        ctx: Context<MintNft>,
        name: String,
        symbol: String,
        uri: String,
        royalty: u16, // basis points: 0-10000. Example: 500 = 5%
    ) -> Result<()> {
        require!(name.len() <= 32, NftError::NameTooLong);
        require!(symbol.len() <= 10, NftError::SymbolTooLong);
        require!(uri.len() <= 200, NftError::UriTooLong);
        require!(royalty <= 10_000, NftError::InvalidRoyalty);
        require!(ctx.accounts.mint.decimals == 0, NftError::InvalidMint);
        require_keys_eq!(
            ctx.accounts.config.authority,
            ctx.accounts.authority.key(),
            NftError::Unauthorized
        );

        let cpi_mint = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        token::mint_to(cpi_mint, 1)?;

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
        }
        .instruction(CreateMetadataAccountV3InstructionArgs {
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

        invoke(
            &metadata_ix,
            &[
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

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
        }
        .instruction(CreateMasterEditionV3InstructionArgs {
            max_supply: Some(0),
        });

        invoke(
            &edition_ix,
            &[
                ctx.accounts.master_edition.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        ctx.accounts.config.nft_count = ctx
            .accounts
            .config
            .nft_count
            .checked_add(1)
            .ok_or(NftError::Overflow)?;

        msg!(
            "NFT minted. Mint: {} | Name: {} | Total: {}",
            ctx.accounts.mint.key(),
            name,
            ctx.accounts.config.nft_count
        );

        emit!(NftMinted {
            mint: ctx.accounts.mint.key(),
            recipient: ctx.accounts.recipient.key(),
            name: name.clone(),
        });

        Ok(())
    }

    pub fn transfer_nft(ctx: Context<TransferNft>) -> Result<()> {
        require!(
            ctx.accounts.from_token_account.amount == 1,
            NftError::TokenNotOwned
        );

        let cpi_transfer = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.from_token_account.to_account_info(),
                to: ctx.accounts.to_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi_transfer, 1)?;

        msg!(
            "NFT transferred from {} to {}",
            ctx.accounts.owner.key(),
            ctx.accounts.recipient.key()
        );

        emit!(NftTransferred {
            mint: ctx.accounts.mint.key(),
            from: ctx.accounts.owner.key(),
            to: ctx.accounts.recipient.key(),
        });

        Ok(())
    }

    pub fn burn_nft(ctx: Context<BurnNft>) -> Result<()> {
        require!(
            ctx.accounts.token_account.amount == 1,
            NftError::TokenNotOwned
        );

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );

        token::burn(cpi_ctx, 1)?;

        emit!(NftBurned {
            mint: ctx.accounts.mint.key(),
            owner: ctx.accounts.owner.key(),
        });

        msg!(
            "NFT burned. Mint: {} | Owner: {}",
            ctx.accounts.mint.key(),
            ctx.accounts.owner.key()
        );

        Ok(())
    }

    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.config.authority,
            NftError::Unauthorized
        );
        ctx.accounts.config.authority = new_authority;
        Ok(())
    }
}

// =============================================================================
// ACCOUNT STRUCTS
// =============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + NftConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, NftConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintNft<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, NftConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

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

    /// CHECK: Verified via seeds constraint derived from Metaplex program
    #[account(
        mut,
        seeds = [
            b"metadata",
            token_metadata_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = token_metadata_program.key(),
        constraint = metadata.data_is_empty() @ NftError::MetadataAlreadyExists
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Verified via seeds constraint derived from Metaplex program  
    #[account(
        mut,
        seeds = [
            b"metadata",
            token_metadata_program.key().as_ref(),
            mint.key().as_ref(),
            b"edition",
        ],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub master_edition: UncheckedAccount<'info>,

    /// CHECK: Verified via address constraint against METADATA_PROGRAM_ID
    #[account(address = METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub recipient: SystemAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferNft<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub recipient: SystemAccount<'info>,
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub to_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnNft<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = authority.key() == config.authority @ NftError::Unauthorized
    )]
    pub config: Account<'info, NftConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// =============================================================================
// STATE
// =============================================================================

#[account]
pub struct NftConfig {
    pub authority: Pubkey, // 32 bytes
    pub nft_count: u64,    //  8 bytes
    pub bump: u8,          //  1 byte
}

impl NftConfig {
    pub const SPACE: usize = 32 + 8 + 1; // 41 bytes
}

// =============================================================================
// EVENTS
// =============================================================================

#[event]
pub struct NftMinted {
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub name: String,
}

#[event]
pub struct NftTransferred {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

#[event]
pub struct NftBurned {
    pub mint: Pubkey,
    pub owner: Pubkey,
}

// =============================================================================
// ERRORS
// =============================================================================

#[error_code]
pub enum NftError {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Symbol must be 10 characters or fewer")]
    SymbolTooLong,
    #[msg("URI must be 200 characters or fewer")]
    UriTooLong,
    #[msg("Royalty basis points must be between 0 and 10000")]
    InvalidRoyalty,
    #[msg("Only the program authority can perform this action")]
    Unauthorized,
    #[msg("Mint must have decimals = 0 for an NFT")]
    InvalidMint,
    #[msg("Metadata account already exists")]
    MetadataAlreadyExists,
    #[msg("Source token account does not hold this NFT")]
    TokenNotOwned,
    #[msg("Arithmetic overflow")]
    Overflow,
}
