use anchor_lang::prelude::*;
use crate::state::*;

pub fn handler(ctx: Context<InitializeConfig>, sbt_type: u8) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.sbt_type = sbt_type;
    config.sbt_count = 0;
    config.bump = ctx.bumps.config;
    msg!("SbtConfig initialized. Type: {} Authority: {}", sbt_type, config.authority);
    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + SbtConfig::SPACE,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump
    )]
    pub config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
