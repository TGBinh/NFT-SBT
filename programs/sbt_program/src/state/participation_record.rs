use anchor_lang::prelude::*;

pub const PARTICIPATION_SEED: &[u8] = b"participation";

#[account]
pub struct ParticipationRecord {
    pub user: Pubkey,
    pub collection_id: [u8; 32],
    pub sbt_type: u8,
    pub mission_index: u8,
    pub minted_at: i64,
    pub bump: u8,
}

impl ParticipationRecord {
    pub const SPACE: usize = 32 + 32 + 1 + 1 + 8 + 1; // 75
}
