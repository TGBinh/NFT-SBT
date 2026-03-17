use anchor_lang::prelude::*;

pub const RALLY_CONFIG_SEED: &[u8] = b"rally_config";

#[account]
pub struct RallyConfig {
    pub rally_id: [u8; 32],
    pub name: String,
    pub symbol: String,
    pub uri_stamp: String,
    pub uri_complete: String,
    pub total_checkpoints: u8,
    pub authority: Pubkey,
    pub participant_count: u64,
    pub active: bool,
    pub bump: u8,
}

impl RallyConfig {
    // 32 + (4+32) + (4+10) + (4+200)*2 + 1 + 32 + 8 + 1 + 1 = 533
    pub const SPACE: usize = 32 + (4 + 32) + (4 + 10) + (4 + 200) * 2 + 1 + 32 + 8 + 1 + 1;
}
