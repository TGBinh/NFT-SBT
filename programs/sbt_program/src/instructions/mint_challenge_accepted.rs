use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::Token2022};
use crate::{errors::SbtError, state::*, token_utils::mint_sft_to_user};

pub fn handler(ctx: Context<MintChallengeAccepted>, issuer: String) -> Result<()> {
    require!(issuer.len() <= 32, SbtError::IssuerTooLong);
    require!(ctx.accounts.challenge_config.active, SbtError::NotActive);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    mint_sft_to_user(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        2u8,
        ctx.accounts.sbt_config.bump,
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let now = Clock::get()?.unix_timestamp;
    let challenge_id = ctx.accounts.challenge_config.challenge_id;

    let record = &mut ctx.accounts.sbt_record;
    record.owner = ctx.accounts.recipient.key();
    record.sbt_type = 2;
    record.collection_id = challenge_id;
    record.mission_index = 0;
    record.issuer = issuer;
    record.issued_at = now;
    record.revoked = false;
    record.bump = ctx.bumps.sbt_record;

    let participation = &mut ctx.accounts.participation_record;
    participation.user = ctx.accounts.recipient.key();
    participation.collection_id = challenge_id;
    participation.sbt_type = 2;
    participation.mission_index = 0;
    participation.minted_at = now;
    participation.bump = ctx.bumps.participation_record;

    ctx.accounts.challenge_config.participant_count = ctx.accounts.challenge_config.participant_count
        .checked_add(1).ok_or(SbtError::Overflow)?;
    ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
        .checked_add(1).ok_or(SbtError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct MintChallengeAccepted<'info> {
    #[account(mut, seeds = [SBT_CONFIG_SEED, &[2u8]], bump = sbt_config.bump)]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub challenge_config: Account<'info, ChallengeConfig>,

    /// CHECK: sft_accepted_mint for this challenge
    #[account(mut, constraint = sft_mint.key() == challenge_config.sft_accepted_mint @ SbtError::MintNotCreated)]
    pub sft_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: recipient wallet
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init, payer = payer, space = 8 + SbtRecord::SPACE,
        seeds = [SBT_RECORD_SEED, challenge_config.challenge_id.as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    #[account(
        init, payer = payer, space = 8 + ParticipationRecord::SPACE,
        seeds = [PARTICIPATION_SEED, &[2u8], challenge_config.challenge_id.as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub participation_record: Account<'info, ParticipationRecord>,

    /// CHECK: ATA for recipient, created by mint_sft_to_user
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
