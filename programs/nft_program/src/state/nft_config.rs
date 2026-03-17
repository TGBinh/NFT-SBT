use anchor_lang::prelude::*;

pub const NFT_CONFIG_SEED: &[u8] = b"nft_config";

#[account]
pub struct NftConfig {
    pub authority: Pubkey,
    pub collection_type: u8,
    pub nft_count: u64,
    pub bump: u8,
}

impl NftConfig {
    pub const SPACE: usize = 32 + 1 + 8 + 1; // 42
}
