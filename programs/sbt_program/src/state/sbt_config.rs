use anchor_lang::prelude::*;

pub const SBT_CONFIG_SEED: &[u8] = b"sbt_config";

#[account]
pub struct SbtConfig {
    pub authority: Pubkey,
    pub sbt_type: u8,
    pub sbt_count: u64,
    pub paused: bool,
    pub bump: u8,
}

impl SbtConfig {
    pub const SPACE: usize = 32 + 1 + 8 + 1 + 1; // 43
}
