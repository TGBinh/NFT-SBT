use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, CloseAccount, Mint, Token, TokenAccount};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<BurnStamp>) -> Result<()> {
    require!(
        ctx.accounts.user_token_account.amount >= 1,
        NftError::TokenNotOwned
    );

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        1,
    )?;

    token::close_account(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.user_token_account.to_account_info(),
                destination: ctx.accounts.user.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
    )?;

    // StampRecord is closed by Anchor `close` constraint — rent returned to user
    msg!("Stamp NFT burned. Mint: {}", ctx.accounts.mint.key());
    Ok(())
}

#[derive(Accounts)]
pub struct BurnStamp<'info> {
    #[account(
        mut,
        seeds = [STAMP_RECORD_SEED, mint.key().as_ref()],
        bump = stamp_record.bump,
        constraint = stamp_record.mint == mint.key() @ NftError::InvalidMint,
        close = user,
    )]
    pub stamp_record: Account<'info, StampRecord>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
