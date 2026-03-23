use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, MintTo, Token, TokenAccount},
};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<MintRwa>, challenge_id: [u8; 32]) -> Result<()> {
    require!(ctx.accounts.rwa_config.active, NftError::NotActive);
    require!(!ctx.accounts.nft_config.paused, NftError::ProgramPaused);
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);

    // Mint 1 token from shared RWA mint to recipient's ATA
    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        1,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let issuance = &mut ctx.accounts.rwa_issuance;
    issuance.challenge_id = challenge_id;
    issuance.user = ctx.accounts.recipient.key();
    issuance.minted_at = now;
    issuance.bump = ctx.bumps.rwa_issuance;

    ctx.accounts.rwa_config.participant_count = ctx.accounts.rwa_config.participant_count
        .checked_add(1).ok_or(NftError::Overflow)?;
    ctx.accounts.nft_config.nft_count = ctx.accounts.nft_config.nft_count
        .checked_add(1).ok_or(NftError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct MintRwa<'info> {
    #[account(mut, seeds = [NFT_CONFIG_SEED, &[0u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(
        mut,
        seeds = [RWA_CONFIG_SEED, &challenge_id],
        bump = rwa_config.bump,
    )]
    pub rwa_config: Account<'info, RwaConfig>,

    /// CHECK: shared RWA mint from rwa_config.sft_mint
    #[account(
        mut,
        constraint = mint.key() == rwa_config.sft_mint @ NftError::MintNotCreated
    )]
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RwaIssuance::SPACE,
        seeds = [RWA_ISSUANCE_SEED, &challenge_id, recipient.key().as_ref()],
        bump,
    )]
    pub rwa_issuance: Account<'info, RwaIssuance>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
