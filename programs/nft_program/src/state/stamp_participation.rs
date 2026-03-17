use anchor_lang::prelude::*;

pub const STAMP_PARTICIPATION_SEED: &[u8] = b"stamp_participation";

#[account]
pub struct StampParticipation {
    pub user: Pubkey,
    pub rally_id: [u8; 32],
    pub checkpoint_index: u8,
    pub minted_at: i64,
    pub bump: u8,
}

impl StampParticipation {
    pub const SPACE: usize = 32 + 32 + 1 + 8 + 1; // 74
}
