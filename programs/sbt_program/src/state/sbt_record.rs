use anchor_lang::prelude::*;

pub const SBT_RECORD_SEED: &[u8] = b"sbt_record";

#[account]
pub struct SbtRecord {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub sbt_type: u8,
    pub uri: String,
    pub event_id: [u8; 32],
    pub challenge_id: [u8; 32],
    pub mission_index: u8,
    pub name: String,
    pub issuer: String,
    pub issued_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

impl SbtRecord {
    // 32+32+1+(4+200)+32+32+1+(4+32)+(4+32)+8+1+1 = 416
    pub const SPACE: usize =
        32 + 32 + 1 + (4 + 200) + 32 + 32 + 1 + (4 + 32) + (4 + 32) + 8 + 1 + 1;
}
