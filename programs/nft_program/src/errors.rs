use anchor_lang::prelude::*;

#[error_code]
pub enum NftError {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Symbol must be 10 characters or fewer")]
    SymbolTooLong,
    #[msg("URI must be 200 characters or fewer")]
    UriTooLong,
    #[msg("Royalty basis points must be between 0 and 10000")]
    InvalidRoyalty,
    #[msg("Only the program authority can perform this action")]
    Unauthorized,
    #[msg("Rally or config is not currently active")]
    NotActive,
    #[msg("checkpoint_index must be less than total_checkpoints or equal to 255")]
    InvalidCheckpointIndex,
    #[msg("total_checkpoints must be between 1 and 254")]
    InvalidTotalCheckpoints,
    #[msg("RWA NFT has already been used")]
    AlreadyUsed,
    #[msg("Token account does not hold this NFT")]
    TokenNotOwned,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Metadata account already exists")]
    MetadataAlreadyExists,
    #[msg("Invalid mint (decimals must be 0)")]
    InvalidMint,
    #[msg("Rally is still active — deactivate it first")]
    StillActive,
}
