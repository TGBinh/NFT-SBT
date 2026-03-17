use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<UseRwa>) -> Result<()> {
    let record = &mut ctx.accounts.rwa_record;

    // 1. Check not already used
    require!(!record.is_used, NftError::AlreadyUsed);

    // 2. Check user holds the token
    // Any current holder of the NFT may mark it used — ownership at use time is
    // proven by the token balance check, not by comparing to owner_at_mint.
    require!(
        ctx.accounts.user_token_account.amount >= 1,
        NftError::TokenNotOwned
    );

    // 3. Mark as used
    record.is_used = true;
    record.used_at = Clock::get()?.unix_timestamp;

    Ok(())
}

#[derive(Accounts)]
pub struct UseRwa<'info> {
    /// The RwaRecord PDA seeded by [RWA_RECORD_SEED, mint.key()]
    #[account(
        mut,
        seeds = [RWA_RECORD_SEED, mint.key().as_ref()],
        bump = rwa_record.bump,
        constraint = rwa_record.mint == mint.key() @ NftError::InvalidMint,
    )]
    pub rwa_record: Account<'info, RwaRecord>,

    /// The mint of the RWA NFT
    pub mint: Account<'info, Mint>,

    /// The user's token account for this mint
    #[account(
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// The user who holds the NFT and signs this transaction
    #[account(mut)]
    pub user: Signer<'info>,
}
