// =============================================================================
// SBT Program — Soulbound Token using Token-2022
// =============================================================================
//
// Soulbound mechanism (two layers):
//
//   Layer 1 — NonTransferable extension (Token-2022 native)
//     The Token-2022 runtime rejects every transfer instruction at the
//     program level. Even a raw SPL transfer bypassing this contract fails.
//
//   Layer 2 — Freeze (defense in depth)
//     After minting, the recipient's token account is frozen. Freeze authority
//     is held by the config PDA. No public instruction can unfreeze it.
//     This blocks the owner from burning or delegating without our consent.
//
// Revocation:
//   The PermanentDelegate extension (set to config PDA during mint) allows
//   the program to burn any token account's balance without the owner's
//   signature. Revoke: thaw (PDA as freeze auth) -> burn (PDA as delegate).
//
// On-chain metadata:
//   All SBT metadata (name, symbol, uri, issuer, issued_at) is stored in the
//   SbtRecord PDA. Metaplex Token Metadata is intentionally omitted because
//   mpl-token-metadata v3 does not fully support Token-2022 mints.
// =============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::{
    associated_token::{create as create_ata, AssociatedToken, Create as CreateAta},
    token_2022::{
        self,
        spl_token_2022::{
            extension::ExtensionType,
            instruction::{
                initialize_mint2, initialize_non_transferable_mint,
                initialize_permanent_delegate, AuthorityType,
            },
            state::Mint as SplMintState,
        },
        Burn, FreezeAccount, MintTo, SetAuthority, ThawAccount, Token2022,
    },
};

// Replace after running: anchor build && anchor keys list
declare_id!("51G8WL8HZnib5SyV929K2DyqGEMRn89Bx6nJMitsP2QH");

// =============================================================================
// CONSTANTS
// =============================================================================

const CONFIG_SEED: &[u8] = b"sbt_config";
const SBT_RECORD_SEED: &[u8] = b"sbt_record";

// =============================================================================
// PROGRAM
// =============================================================================

#[program]
pub mod sbt_program {
    use super::*;

    // -------------------------------------------------------------------------
    // initialize_config
    // One-time setup. Sets the authority who can mint and revoke SBTs.
    // -------------------------------------------------------------------------
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.bump = ctx.bumps.config;
        config.sbt_count = 0;
        msg!("SBT Config initialized. Authority: {}", config.authority);
        Ok(())
    }

    // -------------------------------------------------------------------------
    // mint_sbt
    //
    // Creates a Token-2022 mint with NonTransferable + PermanentDelegate
    // extensions, mints 1 token to the recipient, freezes the account, and
    // writes an on-chain SbtRecord PDA.
    //
    // The mint keypair is passed as a Signer so the caller controls the address.
    // -------------------------------------------------------------------------
    pub fn mint_sbt(
        ctx: Context<MintSbt>,
        name: String,
        symbol: String,
        uri: String,
        issuer: String,
    ) -> Result<()> {
        // Validation
        require!(name.len() <= 32, SbtError::NameTooLong);
        require!(symbol.len() <= 10, SbtError::SymbolTooLong);
        require!(uri.len() <= 200, SbtError::UriTooLong);
        require!(issuer.len() <= 64, SbtError::IssuerTooLong);
        require_keys_eq!(
            ctx.accounts.config.authority,
            ctx.accounts.authority.key(),
            SbtError::Unauthorized
        );

        let config_key = ctx.accounts.config.key();

        let token_2022_program_id = anchor_spl::token_2022::spl_token_2022::id();

        // ------------------------------------------------------------------
        // Step 1: Calculate space and create the raw mint account.
        //
        // Token-2022 extension layout:
        //   [0..82]  base Mint state
        //   [82]     account_type discriminator (1 byte)
        //   [83..]   TLV entries for each extension
        //
        // NonTransferable  : 4 bytes (type u16 + length u16, no data)
        // PermanentDelegate: 4 bytes header + 32 bytes (one Pubkey) = 36 bytes
        //
        // try_calculate_account_len handles alignment; result is typically 170.
        // Extensions MUST be initialised before initialize_mint / initialize_mint2.
        // ------------------------------------------------------------------
        let extension_types = [
            ExtensionType::NonTransferable,
            ExtensionType::PermanentDelegate,
        ];
        let mint_space =
            ExtensionType::try_calculate_account_len::<SplMintState>(&extension_types)
                .map_err(|_| SbtError::ExtensionError)?;

        let rent_lamports = Rent::get()?.minimum_balance(mint_space);

        invoke(
            &system_instruction::create_account(
                &ctx.accounts.authority.key(),
                &ctx.accounts.mint.key(),
                rent_lamports,
                mint_space as u64,
                &token_2022_program_id,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // ------------------------------------------------------------------
        // Step 2: Initialize NonTransferable extension.
        // This alone is sufficient to block all SPL transfers at the runtime
        // level — no instruction in this program needs to check for it.
        // ------------------------------------------------------------------
        invoke(
            &initialize_non_transferable_mint(&token_2022_program_id, &ctx.accounts.mint.key())
                .map_err(|e| {
                    msg!("initialize_non_transferable_mint failed: {:?}", e);
                    SbtError::ExtensionError
                })?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // ------------------------------------------------------------------
        // Step 3: Initialize PermanentDelegate extension.
        // The config PDA is the permanent delegate.
        // This is used in revoke_sbt to burn the token without the
        // recipient's signature (permanent delegate bypasses account ownership
        // checks on burn in Token-2022).
        // ------------------------------------------------------------------
        invoke(
            &initialize_permanent_delegate(
                &token_2022_program_id,
                &ctx.accounts.mint.key(),
                &config_key,
            )
            .map_err(|e| {
                msg!("initialize_permanent_delegate failed: {:?}", e);
                SbtError::ExtensionError
            })?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // ------------------------------------------------------------------
        // Step 4: Initialize the mint (initialize_mint2 does not require the
        // rent sysvar account in the instruction accounts list).
        //
        // mint_authority   = authority (will be set to None in Step 7)
        // freeze_authority = authority (will be transferred to config PDA in Step 9)
        // decimals         = 0   <- mandatory for NFT / SBT
        // ------------------------------------------------------------------
        invoke(
            &initialize_mint2(
                &token_2022_program_id,
                &ctx.accounts.mint.key(),
                &ctx.accounts.authority.key(),
                Some(&ctx.accounts.authority.key()),
                0,
            )
            .map_err(|e| {
                msg!("initialize_mint2 failed: {:?}", e);
                SbtError::ExtensionError
            })?,
            &[ctx.accounts.mint.to_account_info()],
        )?;

        // ------------------------------------------------------------------
        // Step 5: Create the recipient's ATA under the Token-2022 program.
        // Passing token_program = token_2022_program tells the Associated
        // Token Program to derive the ATA with Token-2022 as the owner program.
        // ------------------------------------------------------------------
        create_ata(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            CreateAta {
                payer: ctx.accounts.authority.to_account_info(),
                associated_token: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.recipient.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_2022_program.to_account_info(),
            },
        ))?;

        // ------------------------------------------------------------------
        // Step 6: Mint exactly 1 token to the recipient's ATA.
        // After this step supply = 1; decimals = 0 makes this non-fungible.
        // ------------------------------------------------------------------
        token_2022::mint_to(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            1,
        )?;

        // ------------------------------------------------------------------
        // Step 7: Remove mint authority — supply is permanently locked at 1.
        // Passing None as the new authority removes it entirely.
        // ------------------------------------------------------------------
        token_2022::set_authority(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        // ------------------------------------------------------------------
        // Step 8: Freeze the recipient's token account (defense-in-depth).
        // NonTransferable already blocks transfers. Freeze additionally
        // blocks the owner from burning or setting delegates without PDA
        // consent. This gives the issuer full lifecycle control.
        // ------------------------------------------------------------------
        token_2022::freeze_account(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                FreezeAccount {
                    account: ctx.accounts.token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
        )?;

        // ------------------------------------------------------------------
        // Step 9: Transfer freeze authority to config PDA.
        // After this instruction, nobody can thaw the account without this
        // program signing via PDA seeds. No public unfreeze instruction exists.
        // ------------------------------------------------------------------
        token_2022::set_authority(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            AuthorityType::FreezeAccount,
            Some(config_key),
        )?;

        // ------------------------------------------------------------------
        // Step 10: Write the on-chain SBT record PDA.
        // This is the source of truth for ownership and validity checks.
        // ------------------------------------------------------------------
        let issued_at = Clock::get()?.unix_timestamp;
        let record = &mut ctx.accounts.sbt_record;
        record.owner = ctx.accounts.recipient.key();
        record.mint = ctx.accounts.mint.key();
        record.name = name.clone();
        record.symbol = symbol.clone();
        record.uri = uri.clone();
        record.issuer = issuer.clone();
        record.issued_at = issued_at;
        record.revoked = false;
        record.bump = ctx.bumps.sbt_record;

        ctx.accounts.config.sbt_count = ctx
            .accounts
            .config
            .sbt_count
            .checked_add(1)
            .ok_or(SbtError::Overflow)?;

        msg!(
            "SBT minted. Mint: {} | Recipient: {} | Issuer: {} | IssuedAt: {}",
            ctx.accounts.mint.key(),
            ctx.accounts.recipient.key(),
            issuer,
            issued_at
        );

        Ok(())
    }

    // -------------------------------------------------------------------------
    // revoke_sbt
    //
    // Burns the SBT and marks the record as revoked.
    // Only config.authority can call this.
    //
    // Flow:
    //   1. Thaw  — config PDA signs as freeze authority.
    //   2. Burn  — config PDA signs as permanent delegate (no owner signature).
    //   3. Mark sbt_record.revoked = true.
    // -------------------------------------------------------------------------
    pub fn revoke_sbt(ctx: Context<RevokeSbt>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.config.authority,
            ctx.accounts.authority.key(),
            SbtError::Unauthorized
        );
        require!(!ctx.accounts.sbt_record.revoked, SbtError::AlreadyRevoked);

        let config_bump = ctx.accounts.config.bump;
        let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config_bump]];
        let pda_signer: &[&[&[u8]]] = &[config_seeds];

        // Thaw: config PDA is freeze authority
        token_2022::thaw_account(CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            ThawAccount {
                account: ctx.accounts.token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            pda_signer,
        ))?;

        // Burn: config PDA is permanent delegate.
        // PermanentDelegate in Token-2022 grants unconditional burn rights
        // over any token account associated with this mint, without requiring
        // the account owner to sign.
        token_2022::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_2022_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                pda_signer,
            ),
            1,
        )?;

        ctx.accounts.sbt_record.revoked = true;

        msg!(
            "SBT revoked. Mint: {} | Former owner: {}",
            ctx.accounts.mint.key(),
            ctx.accounts.sbt_record.owner
        );

        Ok(())
    }

    // -------------------------------------------------------------------------
    // verify_sbt
    //
    // Read-only verification. Returns an error if the SBT is invalid, revoked,
    // or the owner / mint does not match the on-chain record.
    // -------------------------------------------------------------------------
    pub fn verify_sbt(ctx: Context<VerifySbt>) -> Result<()> {
        let record = &ctx.accounts.sbt_record;
        require!(!record.revoked, SbtError::SbtRevoked);
        require_keys_eq!(record.owner, ctx.accounts.owner.key(), SbtError::NotOwner);
        require_keys_eq!(record.mint, ctx.accounts.mint.key(), SbtError::MintMismatch);

        msg!(
            "SBT valid. Owner: {} | Issuer: {} | IssuedAt: {} | Name: {}",
            record.owner,
            record.issuer,
            record.issued_at,
            record.name
        );
        Ok(())
    }
}

// =============================================================================
// ACCOUNT STRUCTS
// =============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + SbtConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintSbt<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, SbtConfig>,

    // Must match config.authority; checked via require_keys_eq! in the handler.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Recipient wallet. Only its public key is stored in the SbtRecord.
    ///        The ATA is validated by the Associated Token Program during CPI.
    pub recipient: UncheckedAccount<'info>,

    // The mint keypair is passed as a Signer so we can derive its public key
    // before calling system_instruction::create_account. The caller generates
    // a fresh Keypair and includes it in the transaction signers list.
    /// CHECK: Initialised manually via Token-2022 extension instructions in
    ///        the handler body (create_account -> init extensions -> init mint).
    #[account(mut)]
    pub mint: Signer<'info>,

    // The recipient's ATA for this mint. Created via Associated Token Program
    // CPI in Step 5 of mint_sbt. Must be writable before the CPI creates it.
    /// CHECK: Created by the Associated Token Program CPI in mint_sbt.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    // On-chain record PDA storing all SBT metadata and ownership information.
    #[account(
        init,
        payer = authority,
        space = 8 + SbtRecord::SPACE,
        seeds = [SBT_RECORD_SEED, mint.key().as_ref()],
        bump
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RevokeSbt<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, SbtConfig>,

    // Must match config.authority; checked via require_keys_eq! in the handler.
    #[account(mut)]
    pub authority: Signer<'info>,

    // The SBT mint. Used in thaw_account and burn CPI calls.
    /// CHECK: Validated indirectly: sbt_record.mint is checked in the handler,
    ///        and Anchor verifies sbt_record PDA seeds include mint.key().
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    // The token account holding the SBT (currently frozen).
    // It is identified by sbt_record.owner; no associated_token constraint
    // is needed because the PermanentDelegate burn does not require ATA checks.
    /// CHECK: The config PDA is freeze authority + permanent delegate; the
    ///        handler thaws then burns, which validates the account is associated
    ///        with the correct mint at the Token-2022 program level.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SBT_RECORD_SEED, mint.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifySbt<'info> {
    /// CHECK: Public key is compared against sbt_record.owner in the handler.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: Public key is compared against sbt_record.mint in the handler.
    pub mint: UncheckedAccount<'info>,

    #[account(
        seeds = [SBT_RECORD_SEED, mint.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,
}

// =============================================================================
// STATE
// =============================================================================

#[account]
pub struct SbtConfig {
    pub authority: Pubkey, // 32
    pub sbt_count: u64,    //  8
    pub bump: u8,          //  1
}

impl SbtConfig {
    pub const SPACE: usize = 32 + 8 + 1; // 41
}

#[account]
pub struct SbtRecord {
    pub owner: Pubkey,   // 32  — wallet that holds the SBT
    pub mint: Pubkey,    // 32  — Token-2022 mint address
    pub name: String,    // 4 + 32 = 36
    pub symbol: String,  // 4 + 10 = 14
    pub uri: String,     // 4 + 200 = 204
    pub issuer: String,  // 4 + 64 = 68
    pub issued_at: i64,  //  8  — unix timestamp from Clock::get()
    pub revoked: bool,   //  1
    pub bump: u8,        //  1
}

impl SbtRecord {
    // 32 + 32 + 36 + 14 + 204 + 68 + 8 + 1 + 1 = 396
    pub const SPACE: usize = 32 + 32 + (4 + 32) + (4 + 10) + (4 + 200) + (4 + 64) + 8 + 1 + 1;
}

// =============================================================================
// ERRORS
// =============================================================================

#[error_code]
pub enum SbtError {
    #[msg("Name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Symbol must be 10 characters or fewer")]
    SymbolTooLong,
    #[msg("URI must be 200 characters or fewer")]
    UriTooLong,
    #[msg("Issuer name must be 64 characters or fewer")]
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
    #[msg("Token account does not hold this SBT")]
    TokenNotOwned,
    #[msg("Failed to initialize Token-2022 mint extension")]
    ExtensionError,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("SBT transfer is not allowed — this token is Soulbound")]
    TransferNotAllowed,
}
