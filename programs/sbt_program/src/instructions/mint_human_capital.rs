use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::Token2022};
use crate::{errors::SbtError, state::*, token_utils::mint_sbt_token};

pub fn handler(ctx: Context<MintHumanCapital>, name: String, issuer: String, uri: String) -> Result<()> {
    require!(name.len() <= 32, SbtError::NameTooLong);
    require!(issuer.len() <= 32, SbtError::IssuerTooLong);
    require!(uri.len() <= 200, SbtError::UriTooLong);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    mint_sbt_token(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.rent.to_account_info(),
    )?;

    let zero_id = [0u8; 32];
    let now = Clock::get()?.unix_timestamp;

    // HumanCapital uses mint pubkey bytes as collection_id (unique per user)
    let mint_bytes = ctx.accounts.mint.key().to_bytes();

    let record = &mut ctx.accounts.sbt_record;
    record.owner = ctx.accounts.recipient.key();
    record.sbt_type = 0;
    record.collection_id = mint_bytes;  // unique: mint pubkey as collection_id
    record.mission_index = 0;
    record.issuer = issuer;
    record.issued_at = now;
    record.revoked = false;
    record.bump = ctx.bumps.sbt_record;

    let participation = &mut ctx.accounts.participation_record;
    participation.user = ctx.accounts.recipient.key();
    participation.collection_id = zero_id;
    participation.sbt_type = 0;
    participation.mission_index = 0;
    participation.minted_at = now;
    participation.bump = ctx.bumps.participation_record;

    ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
        .checked_add(1).ok_or(SbtError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct MintHumanCapital<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[0u8]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: recipient wallet
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + SbtRecord::SPACE,
        seeds = [SBT_RECORD_SEED, mint.key().as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    #[account(
        init,
        payer = payer,
        space = 8 + ParticipationRecord::SPACE,
        seeds = [
            PARTICIPATION_SEED,
            &[0u8],
            &[0u8; 32],
            &[0u8],
            recipient.key().as_ref()
        ],
        bump
    )]
    pub participation_record: Account<'info, ParticipationRecord>,

    /// CHECK: initialized manually via Token-2022 instructions
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: created via ATA CPI
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
