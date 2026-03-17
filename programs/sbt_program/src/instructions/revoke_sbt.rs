use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Burn, ThawAccount, Token2022};
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<RevokeSbt>, sbt_type: u8) -> Result<()> {
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    require!(!ctx.accounts.sbt_record.revoked, SbtError::AlreadyRevoked);

    let config_bump = ctx.accounts.sbt_config.bump;
    let pda_signer: &[&[u8]] = &[SBT_CONFIG_SEED, &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    token_2022::thaw_account(CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        ThawAccount {
            account: ctx.accounts.token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.sbt_config.to_account_info(),
        },
        signer_seeds,
    ))?;

    token_2022::burn(CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.to_account_info(),
        Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.sbt_config.to_account_info(),
        },
        signer_seeds,
    ), 1)?;

    ctx.accounts.sbt_record.revoked = true;
    msg!("SBT revoked. Mint: {}", ctx.accounts.mint.key());
    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8)]
pub struct RevokeSbt<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    pub authority: Signer<'info>,

    /// CHECK: validated via sbt_record seeds
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: thawed and burned in handler
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SBT_RECORD_SEED, mint.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
