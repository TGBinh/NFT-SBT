use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, CloseAccount, Mint, Token, TokenAccount};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<BurnStamp>, checkpoint_index: u8) -> Result<()> {
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

    // stamp_participation closed by Anchor `close` constraint — rent returned to user
    msg!("Stamp SFT burned. Checkpoint: {}", checkpoint_index);
    Ok(())
}

#[derive(Accounts)]
#[instruction(checkpoint_index: u8)]
pub struct BurnStamp<'info> {
    #[account(
        mut,
        seeds = [STAMP_PARTICIPATION_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index], user.key().as_ref()],
        bump = stamp_participation.bump,
        close = user,
    )]
    pub stamp_participation: Account<'info, StampParticipation>,

    #[account(seeds = [RALLY_CONFIG_SEED, rally_config.rally_id.as_ref()], bump = rally_config.bump)]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(
        seeds = [CHECKPOINT_MINT_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index]],
        bump = checkpoint_mint_account.bump,
    )]
    pub checkpoint_mint_account: Account<'info, CheckpointMint>,

    #[account(
        mut,
        constraint = mint.key() == checkpoint_mint_account.sft_mint @ NftError::MintNotCreated
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
