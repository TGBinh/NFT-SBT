use anchor_lang::prelude::*;

pub const RWA_ISSUANCE_SEED: &[u8] = b"rwa_issuance";

#[account]
pub struct RwaIssuance {
    pub challenge_id: [u8; 32],
    pub user: Pubkey,
    pub minted_at: i64,
    pub is_used: bool,
    pub used_at: i64,
    pub bump: u8,
}

impl RwaIssuance {
    pub const SPACE: usize = 32 + 32 + 8 + 1 + 8 + 1; // 82
}
