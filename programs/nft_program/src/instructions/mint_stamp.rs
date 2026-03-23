use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, MintTo, Token, TokenAccount},
};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<MintStamp>, checkpoint_index: u8) -> Result<()> {
    require!(ctx.accounts.rally_config.active, NftError::NotActive);
    require!(!ctx.accounts.nft_config.paused, NftError::ProgramPaused);
    require!(
        checkpoint_index < ctx.accounts.rally_config.total_checkpoints || checkpoint_index == 255,
        NftError::InvalidCheckpointIndex
    );
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);
    require!(
        ctx.accounts.checkpoint_mint_account.sft_mint == ctx.accounts.mint.key(),
        NftError::MintNotCreated
    );

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
    let participation = &mut ctx.accounts.stamp_participation;
    participation.user = ctx.accounts.recipient.key();
    participation.rally_id = ctx.accounts.rally_config.rally_id;
    participation.checkpoint_index = checkpoint_index;
    participation.minted_at = now;
    participation.bump = ctx.bumps.stamp_participation;

    ctx.accounts.nft_config.nft_count = ctx.accounts.nft_config.nft_count
        .checked_add(1).ok_or(NftError::Overflow)?;
    ctx.accounts.rally_config.participant_count = ctx.accounts.rally_config.participant_count
        .checked_add(1).ok_or(NftError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(checkpoint_index: u8)]
pub struct MintStamp<'info> {
    #[account(mut, seeds = [NFT_CONFIG_SEED, &[1u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(mut, seeds = [RALLY_CONFIG_SEED, rally_config.rally_id.as_ref()], bump = rally_config.bump)]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(
        seeds = [CHECKPOINT_MINT_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index]],
        bump = checkpoint_mint_account.bump,
    )]
    pub checkpoint_mint_account: Account<'info, CheckpointMint>,

    /// CHECK: shared mint for this checkpoint — validated via checkpoint_mint_account.sft_mint
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + StampParticipation::SPACE,
        seeds = [STAMP_PARTICIPATION_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index], recipient.key().as_ref()],
        bump,
    )]
    pub stamp_participation: Account<'info, StampParticipation>,

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
