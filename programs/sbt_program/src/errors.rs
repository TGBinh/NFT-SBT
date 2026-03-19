use anchor_lang::prelude::*;

#[error_code]
pub enum SbtError {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Symbol must be 10 characters or fewer")]
    SymbolTooLong,
    #[msg("URI must be 200 characters or fewer")]
    UriTooLong,
    #[msg("Issuer must be 32 characters or fewer")]
    IssuerTooLong,
    #[msg("Only the program authority can perform this action")]
    Unauthorized,
    #[msg("This SBT has already been revoked")]
    AlreadyRevoked,
    #[msg("This SBT has been revoked and is no longer valid")]
    SbtRevoked,
    #[msg("The specified wallet is not the owner of this SBT")]
    NotOwner,
    #[msg("Mint address does not match the SBT record")]
    MintMismatch,
    #[msg("Failed to initialize Token-2022 mint extension")]
    ExtensionError,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Event or challenge is not currently active")]
    NotActive,
    #[msg("mission_index must be less than total_missions or equal to 255")]
    InvalidMissionIndex,
    #[msg("total_missions must be between 1 and 254")]
    InvalidTotalMissions,
    #[msg("Event or challenge is still active — deactivate it first")]
    StillActive,
}
