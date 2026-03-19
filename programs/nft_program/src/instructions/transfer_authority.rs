use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<TransferAuthority>, _collection_type: u8, new_authority: Pubkey) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        NftError::Unauthorized
    );
    ctx.accounts.config.authority = new_authority;
    msg!("Authority transferred to {}", new_authority);
    Ok(())
}

#[derive(Accounts)]
#[instruction(collection_type: u8)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [NFT_CONFIG_SEED, &[collection_type]],
        bump = config.bump,
    )]
    pub config: Account<'info, NftConfig>,

    pub authority: Signer<'info>,
}
