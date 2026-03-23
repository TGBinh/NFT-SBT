use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use crate::{errors::SbtError, state::*, token_utils::revoke_sft_from_user};

pub fn handler(ctx: Context<RevokeSbt>, sbt_type: u8, mission_index: u8) -> Result<()> {
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    require!(!ctx.accounts.sbt_record.revoked, SbtError::AlreadyRevoked);

    revoke_sft_from_user(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        sbt_type,
        ctx.accounts.sbt_config.bump,
        &ctx.accounts.token_2022_program.to_account_info(),
    )?;

    ctx.accounts.sbt_record.revoked = true;
    msg!("SBT revoked for user: {} collection: {:?} mission_index: {}",
        ctx.accounts.user.key(), ctx.accounts.sbt_record.collection_id, mission_index);

    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8, mission_index: u8)]
pub struct RevokeSbt<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    pub authority: Signer<'info>,

    /// CHECK: user whose SBT is being revoked
    pub user: UncheckedAccount<'info>,

    /// CHECK: shared SFT mint
    #[account(mut)]
    pub sft_mint: UncheckedAccount<'info>,

    /// CHECK: user's ATA for sft_mint
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SBT_RECORD_SEED, sbt_record.collection_id.as_ref(), &[mission_index], user.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
