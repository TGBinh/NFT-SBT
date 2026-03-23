use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{create as create_ata, Create as CreateAta, AssociatedToken},
    token_2022::{self, FreezeAccount, MintTo, Token2022},
};
use crate::{errors::SbtError, state::*};

/// Batch mint event SBT to multiple recipients via remaining_accounts.
/// remaining_accounts layout per recipient: [recipient_wallet, recipient_ata]
/// No SbtRecord/ParticipationRecord created — use individual mint_event_sbt for full records.
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, BatchMintEvent<'info>>) -> Result<()> {
    require!(ctx.accounts.event_config.active, SbtError::NotActive);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    require!(ctx.accounts.sft_mint.key() == ctx.accounts.event_config.sft_mint, SbtError::MintNotCreated);

    let sbt_type = 1u8;
    let config_bump = ctx.accounts.sbt_config.bump;
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    let remaining = ctx.remaining_accounts;
    require!(remaining.len() % 2 == 0, SbtError::Overflow);

    for i in (0..remaining.len()).step_by(2) {
        let recipient = &remaining[i];
        let ata = &remaining[i + 1];

        create_ata(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            CreateAta {
                payer: ctx.accounts.authority.to_account_info(),
                associated_token: ata.to_account_info(),
                authority: recipient.to_account_info(),
                mint: ctx.accounts.sft_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_2022_program.to_account_info(),
            },
        ))?;

        token_2022::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.sft_mint.to_account_info(),
                to: ata.to_account_info(),
                authority: ctx.accounts.sbt_config.to_account_info(),
            },
            signer_seeds,
        ), 1)?;

        token_2022::freeze_account(CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            FreezeAccount {
                account: ata.to_account_info(),
                mint: ctx.accounts.sft_mint.to_account_info(),
                authority: ctx.accounts.sbt_config.to_account_info(),
            },
            signer_seeds,
        ))?;

        ctx.accounts.event_config.participant_count = ctx.accounts.event_config.participant_count
            .checked_add(1).ok_or(SbtError::Overflow)?;
        ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
            .checked_add(1).ok_or(SbtError::Overflow)?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct BatchMintEvent<'info> {
    #[account(mut, seeds = [SBT_CONFIG_SEED, &[1u8]], bump = sbt_config.bump)]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: shared SFT mint for this event
    #[account(mut)]
    pub sft_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
