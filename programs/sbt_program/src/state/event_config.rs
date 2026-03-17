use anchor_lang::prelude::*;

pub const EVENT_CONFIG_SEED: &[u8] = b"event_config";

#[account]
pub struct EventConfig {
    pub event_id: [u8; 32],
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub authority: Pubkey,
    pub participant_count: u64,
    pub active: bool,
    pub bump: u8,
}

impl EventConfig {
    // 32 + (4+32) + (4+10) + (4+200) + 32 + 8 + 1 + 1 = 328
    pub const SPACE: usize = 32 + (4 + 32) + (4 + 10) + (4 + 200) + 32 + 8 + 1 + 1;
}
