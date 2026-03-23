use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<UseRwa>, challenge_id: [u8; 32]) -> Result<()> {
    let issuance = &mut ctx.accounts.rwa_issuance;
    require!(!issuance.is_used, NftError::AlreadyUsed);
    require!(ctx.accounts.user_token_account.amount >= 1, NftError::TokenNotOwned);

    issuance.is_used = true;
    issuance.used_at = Clock::get()?.unix_timestamp;
    msg!("RWA marked as used. Challenge: {:?} User: {}", challenge_id, ctx.accounts.user.key());
    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct UseRwa<'info> {
    #[account(
        mut,
        seeds = [RWA_ISSUANCE_SEED, &challenge_id, user.key().as_ref()],
        bump = rwa_issuance.bump,
    )]
    pub rwa_issuance: Account<'info, RwaIssuance>,

    #[account(
        seeds = [RWA_CONFIG_SEED, &challenge_id],
        bump = rwa_config.bump,
    )]
    pub rwa_config: Account<'info, RwaConfig>,

    #[account(
        mut,
        constraint = mint.key() == rwa_config.sft_mint @ NftError::MintNotCreated
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
