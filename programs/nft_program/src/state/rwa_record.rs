use anchor_lang::prelude::*;

pub const RWA_RECORD_SEED: &[u8] = b"rwa_record";

#[account]
pub struct RwaRecord {
    pub mint: Pubkey,
    pub owner_at_mint: Pubkey,
    pub challenge_id: [u8; 32],
    pub is_used: bool,
    pub used_at: i64,
    pub bump: u8,
}

impl RwaRecord {
    pub const SPACE: usize = 32 + 32 + 32 + 1 + 8 + 1; // 106
}
