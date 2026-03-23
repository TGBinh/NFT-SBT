use anchor_lang::prelude::*;

pub const CHECKPOINT_MINT_SEED: &[u8] = b"checkpoint_mint";

#[account]
pub struct CheckpointMint {
    pub rally_id: [u8; 32],
    pub checkpoint_index: u8,
    pub sft_mint: Pubkey,
    pub bump: u8,
}

impl CheckpointMint {
    pub const SPACE: usize = 32 + 1 + 32 + 1; // 66
}
