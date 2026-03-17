use anchor_lang::prelude::*;

pub const STAMP_RECORD_SEED: &[u8] = b"stamp_record";

#[account]
pub struct StampRecord {
    pub mint: Pubkey,
    pub rally_id: [u8; 32],
    pub checkpoint_index: u8,
    pub bump: u8,
}

impl StampRecord {
    pub const SPACE: usize = 32 + 32 + 1 + 1; // 66
}
