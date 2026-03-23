use anchor_lang::prelude::*;

pub const RWA_CONFIG_SEED: &[u8] = b"rwa_config";

#[account]
pub struct RwaConfig {
    pub challenge_id: [u8; 32],
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub royalty: u16,
    pub sft_mint: Pubkey,
    pub authority: Pubkey,
    pub participant_count: u64,
    pub active: bool,
    pub bump: u8,
}

impl RwaConfig {
    // 32 + (4+32) + (4+10) + (4+200) + 2 + 32 + 32 + 8 + 1 + 1 = 362
    pub const SPACE: usize = 32 + (4 + 32) + (4 + 10) + (4 + 200) + 2 + 32 + 32 + 8 + 1 + 1;
}
