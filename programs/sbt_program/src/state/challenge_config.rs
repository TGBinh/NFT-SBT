use anchor_lang::prelude::*;

pub const CHALLENGE_CONFIG_SEED: &[u8] = b"challenge_config";

#[account]
pub struct ChallengeConfig {
    pub challenge_id: [u8; 32],
    pub name: String,
    pub symbol: String,
    pub uri_accepted: String,
    pub uri_mission: String,
    pub uri_complete: String,
    pub total_missions: u8,
    pub authority: Pubkey,
    pub participant_count: u64,
    pub active: bool,
    pub bump: u8,
}

impl ChallengeConfig {
    // 32 + (4+32) + (4+10) + (4+200)*3 + 1 + 32 + 8 + 1 + 1 = 737
    pub const SPACE: usize =
        32 + (4 + 32) + (4 + 10) + (4 + 200) * 3 + 1 + 32 + 8 + 1 + 1;
}
