use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, CloseAccount, Mint, Token, TokenAccount};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<BurnRwa>, challenge_id: [u8; 32]) -> Result<()> {
    require!(ctx.accounts.user_token_account.amount >= 1, NftError::TokenNotOwned);

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

    // rwa_issuance closed by Anchor `close` constraint — rent returned to user
    msg!("RWA SFT burned. Challenge: {:?}", challenge_id);
    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct BurnRwa<'info> {
    #[account(
        mut,
        seeds = [RWA_ISSUANCE_SEED, &challenge_id, user.key().as_ref()],
        bump = rwa_issuance.bump,
        close = user,
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
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
