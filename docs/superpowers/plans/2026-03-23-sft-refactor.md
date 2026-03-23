# SFT Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor sbt_program và nft_program từ unique-mint-per-user sang SFT model (1 shared mint per collection type, N users hold balance=1).

**Architecture:**
- sbt_program: Token-2022, SbtConfig PDA là mint/freeze/permanent_delegate authority. Event/Challenge dùng shared mint với NonTransferable + PermanentDelegate + MetadataPointer(self) + TokenMetadata embedded. HumanCapital (type=0) giữ nguyên unique.
- nft_program: SPL Token + Metaplex. RWA và Stamp dùng shared mint per challenge_id / per checkpoint. Transferable, không có NonTransferable.
- SbtRecord đổi seed sang `[sbt_record, collection_id, mission_index, user]`, bỏ mint/uri/name fields.

**Tech Stack:** Anchor 0.32.1, Token-2022, spl-token-metadata-interface 0.3, SPL Token classic, Metaplex token-metadata 5.1.0, TypeScript tests.

---

## Phase A — sbt_program state + errors

### Task 1: SbtConfig add paused + SbtError add ProgramPaused

**Files:**
- Modify: `programs/sbt_program/src/state/sbt_config.rs`
- Modify: `programs/sbt_program/src/errors.rs`

- [ ] Edit `sbt_config.rs` — thêm field `paused: bool`, tăng SPACE thêm 1:
```rust
pub struct SbtConfig {
    pub authority: Pubkey,
    pub sbt_type: u8,
    pub sbt_count: u64,
    pub paused: bool,   // NEW
    pub bump: u8,
}
impl SbtConfig {
    pub const SPACE: usize = 32 + 1 + 8 + 1 + 1; // 43
}
```

- [ ] Edit `errors.rs` — thêm 2 variants vào cuối enum:
```rust
#[msg("Program is paused — contact admin")]
ProgramPaused,
#[msg("SFT mint has not been created for this collection — call create_event or create_challenge first")]
MintNotCreated,
```

- [ ] Edit `initialize_config.rs` — thêm `config.paused = false;` sau `config.sbt_count = 0;`

- [ ] Run `cd /home/binh/Desktop/NFT-SBT && anchor build -- -p sbt_program 2>&1 | tail -5`
  Expected: compile error về SPACE mismatch trong các instruction (sbt_config account constraint) — bình thường, sẽ fix ở task sau.

- [ ] Commit:
```bash
git add programs/sbt_program/src/state/sbt_config.rs programs/sbt_program/src/errors.rs programs/sbt_program/src/instructions/initialize_config.rs
git commit -m "feat(sbt): add paused field to SbtConfig, ProgramPaused error"
```

---

### Task 2: EventConfig add sft_mint

**Files:**
- Modify: `programs/sbt_program/src/state/event_config.rs`

- [ ] Edit `event_config.rs`:
```rust
pub struct EventConfig {
    pub event_id: [u8; 32],
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub authority: Pubkey,
    pub participant_count: u64,
    pub active: bool,
    pub sft_mint: Pubkey,   // NEW — shared mint for this event
    pub bump: u8,
}
impl EventConfig {
    // 32 + (4+32) + (4+10) + (4+200) + 32 + 8 + 1 + 32 + 1 = 360
    pub const SPACE: usize = 32 + (4 + 32) + (4 + 10) + (4 + 200) + 32 + 8 + 1 + 32 + 1;
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/state/event_config.rs
git commit -m "feat(sbt): add sft_mint to EventConfig"
```

---

### Task 3: ChallengeConfig add 3 sft_mint fields

**Files:**
- Modify: `programs/sbt_program/src/state/challenge_config.rs`

- [ ] Edit `challenge_config.rs` — thêm 3 Pubkey fields, tăng SPACE += 96:
```rust
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
    pub sft_accepted_mint: Pubkey,   // NEW
    pub sft_mission_mint: Pubkey,    // NEW
    pub sft_complete_mint: Pubkey,   // NEW
    pub bump: u8,
}
impl ChallengeConfig {
    // 32 + (4+32) + (4+10) + (4+200)*3 + 1 + 32 + 8 + 1 + 32*3 + 1 = 833
    pub const SPACE: usize =
        32 + (4 + 32) + (4 + 10) + (4 + 200) * 3 + 1 + 32 + 8 + 1 + 32 * 3 + 1;
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/state/challenge_config.rs
git commit -m "feat(sbt): add sft_accepted/mission/complete_mint to ChallengeConfig"
```

---

### Task 4: SbtRecord redesign

**Files:**
- Modify: `programs/sbt_program/src/state/sbt_record.rs`

- [ ] Rewrite `sbt_record.rs` — bỏ mint/uri/name/event_id/challenge_id, thêm collection_id, đổi seed constant:
```rust
use anchor_lang::prelude::*;

pub const SBT_RECORD_SEED: &[u8] = b"sbt_record";

#[account]
pub struct SbtRecord {
    pub owner: Pubkey,
    pub sbt_type: u8,
    pub collection_id: [u8; 32],  // event_id or challenge_id
    pub mission_index: u8,
    pub issuer: String,           // max 32 chars
    pub issued_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

impl SbtRecord {
    // 32 + 1 + 32 + 1 + (4+32) + 8 + 1 + 1 = 112
    pub const SPACE: usize = 32 + 1 + 32 + 1 + (4 + 32) + 8 + 1 + 1;
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/state/sbt_record.rs
git commit -m "feat(sbt): redesign SbtRecord — remove mint/uri/name, add collection_id, new seed pattern"
```

---

## Phase B — sbt_program token_utils rewrite

### Task 5: Rewrite token_utils.rs

**Files:**
- Modify: `programs/sbt_program/src/token_utils.rs`
- Modify: `programs/sbt_program/Cargo.toml`

- [ ] Edit `Cargo.toml` — thêm dependency:
```toml
spl-token-metadata-interface = "0.3"
```

- [ ] Rewrite `token_utils.rs`:
```rust
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke, program::invoke_signed, system_instruction},
};
use anchor_spl::{
    associated_token::{create as create_ata, Create as CreateAta},
    token_2022::{
        self,
        spl_token_2022::{
            extension::{metadata_pointer::instruction as mp_ix, ExtensionType},
            instruction::{
                initialize_mint2, initialize_non_transferable_mint,
                initialize_permanent_delegate,
            },
            state::Mint as SplMintState,
        },
        FreezeAccount, MintTo, ThawAccount, Burn,
    },
};
use spl_token_metadata_interface::instruction::{initialize as init_metadata, update_field};
use spl_token_metadata_interface::state::Field;

/// Creates a shared SFT mint (NonTransferable + PermanentDelegate + MetadataPointer + TokenMetadata).
/// SbtConfig PDA is mint authority, freeze authority, and permanent delegate.
/// mint_authority is KEPT (not removed) so future mint_sft_to_user calls can succeed.
pub fn create_sft_mint<'info>(
    mint: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    name: String,
    symbol: String,
    uri: String,
    token_2022_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();

    let base_ext = [
        ExtensionType::NonTransferable,
        ExtensionType::PermanentDelegate,
        ExtensionType::MetadataPointer,
    ];
    let base_size = ExtensionType::try_calculate_account_len::<SplMintState>(&base_ext)
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?;

    // Variable TokenMetadata TLV overhead: 4 (type) + 4 (len) + 32 (update_authority) + 32 (mint)
    //   + (4+name.len) + (4+symbol.len) + (4+uri.len) + 4 (additional vec len) + 64 (safety buffer)
    let metadata_len = 4 + 4 + 32 + 32
        + (4 + name.len())
        + (4 + symbol.len())
        + (4 + uri.len())
        + 4 + 64;
    let mint_space = base_size + metadata_len;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);

    // 1: allocate mint account
    invoke(
        &system_instruction::create_account(
            payer.key,
            mint.key,
            rent_lamports,
            mint_space as u64,
            &token_2022_id,
        ),
        &[payer.clone(), mint.clone(), system_program.clone()],
    )?;

    // 2: MetadataPointer — must be before initialize_mint, self-referential
    invoke(
        &mp_ix::initialize(
            &token_2022_id,
            mint.key,
            Some(*sbt_config.key), // update authority = SbtConfig PDA
            Some(*mint.key),       // metadata address = mint itself
        )
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 3: NonTransferable
    invoke(
        &initialize_non_transferable_mint(&token_2022_id, mint.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 4: PermanentDelegate = SbtConfig PDA
    invoke(
        &initialize_permanent_delegate(&token_2022_id, mint.key, sbt_config.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 5: initialize_mint2 — mint_authority and freeze_authority = SbtConfig PDA
    invoke(
        &initialize_mint2(
            &token_2022_id,
            mint.key,
            sbt_config.key,
            Some(sbt_config.key),
            0,
        )
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 6: initialize TokenMetadata — SbtConfig PDA must sign as mint_authority
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];
    invoke_signed(
        &init_metadata(
            &token_2022_id,
            mint.key,        // metadata (= mint itself)
            sbt_config.key,  // update authority
            mint.key,        // mint
            sbt_config.key,  // mint authority (must sign)
            name,
            symbol,
            uri,
        ),
        &[mint.clone(), sbt_config.clone()],
        signer_seeds,
    )?;

    Ok(())
}

/// Mint 1 SFT token to user's ATA and freeze the ATA.
/// SbtConfig PDA signs as mint authority and freeze authority.
pub fn mint_sft_to_user<'info>(
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    token_2022_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    // Create ATA for recipient
    create_ata(CpiContext::new(
        associated_token_program.clone(),
        CreateAta {
            payer: payer.clone(),
            associated_token: token_account.clone(),
            authority: recipient.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_2022_program.clone(),
        },
    ))?;

    // mint_to(1) — SbtConfig PDA signs
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_2022_program.clone(),
            MintTo {
                mint: mint.clone(),
                to: token_account.clone(),
                authority: sbt_config.clone(),
            },
            signer_seeds,
        ),
        1,
    )?;

    // Freeze recipient ATA
    token_2022::freeze_account(CpiContext::new_with_signer(
        token_2022_program.clone(),
        FreezeAccount {
            account: token_account.clone(),
            mint: mint.clone(),
            authority: sbt_config.clone(),
        },
        signer_seeds,
    ))?;

    Ok(())
}

/// Revoke: thaw ATA then burn 1 token using PermanentDelegate.
pub fn revoke_sft_from_user<'info>(
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    token_2022_program: &AccountInfo<'info>,
) -> Result<()> {
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    // Thaw (freeze authority = SbtConfig PDA)
    token_2022::thaw_account(CpiContext::new_with_signer(
        token_2022_program.clone(),
        ThawAccount {
            account: token_account.clone(),
            mint: mint.clone(),
            authority: sbt_config.clone(),
        },
        signer_seeds,
    ))?;

    // Burn (permanent_delegate = SbtConfig PDA)
    token_2022::burn(
        CpiContext::new_with_signer(
            token_2022_program.clone(),
            Burn {
                mint: mint.clone(),
                from: token_account.clone(),
                authority: sbt_config.clone(),
            },
            signer_seeds,
        ),
        1,
    )?;

    Ok(())
}

/// Update a single TokenMetadata field (name, symbol, or uri) on a shared SFT mint.
/// SbtConfig PDA signs as update authority.
pub fn update_sft_metadata_field<'info>(
    mint: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    field: Field,
    value: String,
    token_2022_program: &AccountInfo<'info>,
) -> Result<()> {
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];
    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();

    invoke_signed(
        &update_field(&token_2022_id, mint.key, sbt_config.key, field, value),
        &[mint.clone(), sbt_config.clone()],
        signer_seeds,
    )?;

    Ok(())
}

/// Legacy function kept for HumanCapital (type=0) unique SBT.
/// Creates a unique mint per user: NonTransferable + PermanentDelegate, then
/// removes mint authority, freezes ATA, transfers freeze authority to config PDA.
pub fn mint_sbt_token<'info>(
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    permanent_delegate: &AccountInfo<'info>,
    token_2022_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    _rent: &AccountInfo<'info>,
) -> Result<()> {
    use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
    use anchor_spl::token_2022::{SetAuthority};

    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();
    let extension_types = [
        ExtensionType::NonTransferable,
        ExtensionType::PermanentDelegate,
    ];
    let mint_space =
        ExtensionType::try_calculate_account_len::<SplMintState>(&extension_types)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);

    invoke(
        &system_instruction::create_account(
            authority.key, mint.key, rent_lamports, mint_space as u64, &token_2022_id,
        ),
        &[authority.clone(), mint.clone(), system_program.clone()],
    )?;
    invoke(
        &initialize_non_transferable_mint(&token_2022_id, mint.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;
    invoke(
        &initialize_permanent_delegate(&token_2022_id, mint.key, permanent_delegate.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;
    invoke(
        &initialize_mint2(&token_2022_id, mint.key, authority.key, Some(authority.key), 0)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;
    create_ata(CpiContext::new(
        associated_token_program.clone(),
        CreateAta {
            payer: authority.clone(),
            associated_token: token_account.clone(),
            authority: recipient.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_2022_program.clone(),
        },
    ))?;
    token_2022::mint_to(
        CpiContext::new(
            token_2022_program.clone(),
            MintTo { mint: mint.clone(), to: token_account.clone(), authority: authority.clone() },
        ),
        1,
    )?;
    token_2022::set_authority(
        CpiContext::new(
            token_2022_program.clone(),
            SetAuthority { account_or_mint: mint.clone(), current_authority: authority.clone() },
        ),
        AuthorityType::MintTokens,
        None,
    )?;
    token_2022::freeze_account(CpiContext::new(
        token_2022_program.clone(),
        FreezeAccount { account: token_account.clone(), mint: mint.clone(), authority: authority.clone() },
    ))?;
    token_2022::set_authority(
        CpiContext::new(
            token_2022_program.clone(),
            SetAuthority { account_or_mint: mint.clone(), current_authority: authority.clone() },
        ),
        AuthorityType::FreezeAccount,
        Some(*permanent_delegate.key),
    )?;
    Ok(())
}
```

- [ ] Run `anchor build -- -p sbt_program 2>&1 | grep "^error" | head -20` — expect errors from instructions still referencing old SbtRecord fields. Proceed anyway.

- [ ] Commit:
```bash
git add programs/sbt_program/Cargo.toml programs/sbt_program/src/token_utils.rs
git commit -m "feat(sbt): rewrite token_utils — add create_sft_mint, mint_sft_to_user, revoke_sft_from_user, update_sft_metadata_field"
```

---

## Phase C — sbt_program instructions

### Task 6: create_event.rs — tạo SFT mint khi tạo event

**Files:**
- Modify: `programs/sbt_program/src/instructions/create_event.rs`

- [ ] Rewrite `create_event.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use crate::{errors::SbtError, state::*, token_utils::create_sft_mint};

pub fn handler(
    ctx: Context<CreateEvent>,
    event_id: [u8; 32],
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    require!(name.len() <= 32, SbtError::NameTooLong);
    require!(symbol.len() <= 10, SbtError::SymbolTooLong);
    require!(uri.len() <= 200, SbtError::UriTooLong);
    require_keys_eq!(
        ctx.accounts.sbt_config.authority,
        ctx.accounts.authority.key(),
        SbtError::Unauthorized
    );

    let sbt_type = 1u8;
    let config_bump = ctx.accounts.sbt_config.bump;

    create_sft_mint(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        sbt_type,
        config_bump,
        name.clone(),
        symbol.clone(),
        uri.clone(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let config = &mut ctx.accounts.event_config;
    config.event_id = event_id;
    config.name = name;
    config.symbol = symbol;
    config.uri = uri;
    config.authority = ctx.accounts.authority.key();
    config.participant_count = 0;
    config.active = true;
    config.sft_mint = ctx.accounts.sft_mint.key();
    config.bump = ctx.bumps.event_config;

    Ok(())
}

#[derive(Accounts)]
#[instruction(event_id: [u8; 32])]
pub struct CreateEvent<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[1u8]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + EventConfig::SPACE,
        seeds = [EVENT_CONFIG_SEED, &event_id],
        bump,
    )]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: initialized manually in handler via create_sft_mint
    #[account(mut)]
    pub sft_mint: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/create_event.rs
git commit -m "feat(sbt): create_event creates SFT mint with Token-2022 extensions"
```

---

### Task 7: create_challenge.rs — tạo 3 SFT mints

**Files:**
- Modify: `programs/sbt_program/src/instructions/create_challenge.rs`

- [ ] Rewrite `create_challenge.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use crate::{errors::SbtError, state::*, token_utils::create_sft_mint};

pub fn handler(
    ctx: Context<CreateChallenge>,
    challenge_id: [u8; 32],
    name: String,
    symbol: String,
    uri_accepted: String,
    uri_mission: String,
    uri_complete: String,
    total_missions: u8,
) -> Result<()> {
    require!(name.len() <= 32, SbtError::NameTooLong);
    require!(symbol.len() <= 10, SbtError::SymbolTooLong);
    require!(uri_accepted.len() <= 200, SbtError::UriTooLong);
    require!(uri_mission.len() <= 200, SbtError::UriTooLong);
    require!(uri_complete.len() <= 200, SbtError::UriTooLong);
    require!(total_missions >= 1 && total_missions <= 254, SbtError::InvalidTotalMissions);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    let config_bump = ctx.accounts.sbt_config.bump;
    let symbol_accepted = format!("{}A", &symbol[..symbol.len().min(9)]);
    let symbol_mission = format!("{}M", &symbol[..symbol.len().min(9)]);
    let symbol_complete = format!("{}C", &symbol[..symbol.len().min(9)]);

    // sbt_type=2 for ChallengeAccepted, sbt_type=3 for ChallengeMission
    create_sft_mint(
        &ctx.accounts.sft_accepted_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.sbt_config_accepted.to_account_info(),
        2u8,
        ctx.accounts.sbt_config_accepted.bump,
        format!("{} Accepted", name),
        symbol_accepted,
        uri_accepted.clone(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    create_sft_mint(
        &ctx.accounts.sft_mission_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.sbt_config_mission.to_account_info(),
        3u8,
        ctx.accounts.sbt_config_mission.bump,
        format!("{} Mission", name),
        symbol_mission,
        uri_mission.clone(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    create_sft_mint(
        &ctx.accounts.sft_complete_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.sbt_config_mission.to_account_info(),
        3u8,
        ctx.accounts.sbt_config_mission.bump,
        format!("{} Complete", name),
        symbol_complete,
        uri_complete.clone(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let cfg = &mut ctx.accounts.challenge_config;
    cfg.challenge_id = challenge_id;
    cfg.name = name;
    cfg.symbol = symbol;
    cfg.uri_accepted = uri_accepted;
    cfg.uri_mission = uri_mission;
    cfg.uri_complete = uri_complete;
    cfg.total_missions = total_missions;
    cfg.authority = ctx.accounts.authority.key();
    cfg.participant_count = 0;
    cfg.active = true;
    cfg.sft_accepted_mint = ctx.accounts.sft_accepted_mint.key();
    cfg.sft_mission_mint = ctx.accounts.sft_mission_mint.key();
    cfg.sft_complete_mint = ctx.accounts.sft_complete_mint.key();
    cfg.bump = ctx.bumps.challenge_config;

    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct CreateChallenge<'info> {
    // SbtConfig type=2 (ChallengeAccepted) — used for accepted + mission+complete mints
    #[account(
        seeds = [SBT_CONFIG_SEED, &[2u8]],
        bump = sbt_config.bump,
        constraint = sbt_config.authority == authority.key() @ SbtError::Unauthorized
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    // SbtConfig type=2 for accepted mint authority
    #[account(
        seeds = [SBT_CONFIG_SEED, &[2u8]],
        bump = sbt_config_accepted.bump,
    )]
    pub sbt_config_accepted: Account<'info, SbtConfig>,

    // SbtConfig type=3 for mission/complete mint authority
    #[account(
        seeds = [SBT_CONFIG_SEED, &[3u8]],
        bump = sbt_config_mission.bump,
    )]
    pub sbt_config_mission: Account<'info, SbtConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + ChallengeConfig::SPACE,
        seeds = [CHALLENGE_CONFIG_SEED, &challenge_id],
        bump,
    )]
    pub challenge_config: Account<'info, ChallengeConfig>,

    /// CHECK: initialized manually
    #[account(mut)]
    pub sft_accepted_mint: Signer<'info>,

    /// CHECK: initialized manually
    #[account(mut)]
    pub sft_mission_mint: Signer<'info>,

    /// CHECK: initialized manually
    #[account(mut)]
    pub sft_complete_mint: Signer<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/create_challenge.rs
git commit -m "feat(sbt): create_challenge creates 3 SFT mints (accepted/mission/complete)"
```

---

### Task 8: update_event.rs — propagate metadata to TokenMetadata extension

**Files:**
- Modify: `programs/sbt_program/src/instructions/update_event.rs`

- [ ] Rewrite `update_event.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use spl_token_metadata_interface::state::Field;
use crate::{errors::SbtError, state::*, token_utils::update_sft_metadata_field};

pub fn handler(
    ctx: Context<UpdateEvent>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri: Option<String>,
) -> Result<()> {
    require_keys_eq!(ctx.accounts.event_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    let config = &mut ctx.accounts.event_config;
    config.active = active;

    let sbt_type = 1u8;
    let config_bump = ctx.accounts.sbt_config.bump;

    if let Some(new_name) = name {
        require!(new_name.len() <= 32, SbtError::NameTooLong);
        update_sft_metadata_field(
            &ctx.accounts.sft_mint.to_account_info(),
            &ctx.accounts.sbt_config.to_account_info(),
            sbt_type, config_bump,
            Field::Name, new_name.clone(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        config.name = new_name;
    }
    if let Some(new_symbol) = symbol {
        require!(new_symbol.len() <= 10, SbtError::SymbolTooLong);
        update_sft_metadata_field(
            &ctx.accounts.sft_mint.to_account_info(),
            &ctx.accounts.sbt_config.to_account_info(),
            sbt_type, config_bump,
            Field::Symbol, new_symbol.clone(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        config.symbol = new_symbol;
    }
    if let Some(new_uri) = uri {
        require!(new_uri.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(
            &ctx.accounts.sft_mint.to_account_info(),
            &ctx.accounts.sbt_config.to_account_info(),
            sbt_type, config_bump,
            Field::Uri, new_uri.clone(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        config.uri = new_uri;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateEvent<'info> {
    #[account(
        seeds = [SBT_CONFIG_SEED, &[1u8]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: SFT mint for this event — validated via event_config.sft_mint
    #[account(
        mut,
        constraint = sft_mint.key() == event_config.sft_mint @ SbtError::MintNotCreated
    )]
    pub sft_mint: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
    pub token_2022_program: Program<'info, Token2022>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/update_event.rs
git commit -m "feat(sbt): update_event propagates metadata changes to SFT mint TokenMetadata"
```

---

### Task 9: update_challenge.rs — propagate metadata changes

**Files:**
- Modify: `programs/sbt_program/src/instructions/update_challenge.rs`

- [ ] Rewrite `update_challenge.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use spl_token_metadata_interface::state::Field;
use crate::{errors::SbtError, state::*, token_utils::update_sft_metadata_field};

pub fn handler(
    ctx: Context<UpdateChallenge>,
    active: bool,
    name: Option<String>,
    symbol: Option<String>,
    uri_accepted: Option<String>,
    uri_mission: Option<String>,
    uri_complete: Option<String>,
) -> Result<()> {
    require_keys_eq!(ctx.accounts.challenge_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    let config = &mut ctx.accounts.challenge_config;
    config.active = active;

    let bump_2 = ctx.accounts.sbt_config_accepted.bump;
    let bump_3 = ctx.accounts.sbt_config_mission.bump;

    if let Some(n) = name {
        require!(n.len() <= 32, SbtError::NameTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_accepted_mint.to_account_info(), &ctx.accounts.sbt_config_accepted.to_account_info(), 2, bump_2, Field::Name, format!("{} Accepted", n), &ctx.accounts.token_2022_program.to_account_info())?;
        update_sft_metadata_field(&ctx.accounts.sft_mission_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Name, format!("{} Mission", n), &ctx.accounts.token_2022_program.to_account_info())?;
        update_sft_metadata_field(&ctx.accounts.sft_complete_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Name, format!("{} Complete", n), &ctx.accounts.token_2022_program.to_account_info())?;
        config.name = n;
    }
    if let Some(s) = symbol {
        require!(s.len() <= 10, SbtError::SymbolTooLong);
        config.symbol = s;
    }
    if let Some(u) = uri_accepted {
        require!(u.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_accepted_mint.to_account_info(), &ctx.accounts.sbt_config_accepted.to_account_info(), 2, bump_2, Field::Uri, u.clone(), &ctx.accounts.token_2022_program.to_account_info())?;
        config.uri_accepted = u;
    }
    if let Some(u) = uri_mission {
        require!(u.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_mission_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Uri, u.clone(), &ctx.accounts.token_2022_program.to_account_info())?;
        config.uri_mission = u;
    }
    if let Some(u) = uri_complete {
        require!(u.len() <= 200, SbtError::UriTooLong);
        update_sft_metadata_field(&ctx.accounts.sft_complete_mint.to_account_info(), &ctx.accounts.sbt_config_mission.to_account_info(), 3, bump_3, Field::Uri, u.clone(), &ctx.accounts.token_2022_program.to_account_info())?;
        config.uri_complete = u;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateChallenge<'info> {
    #[account(seeds = [SBT_CONFIG_SEED, &[2u8]], bump = sbt_config_accepted.bump)]
    pub sbt_config_accepted: Account<'info, SbtConfig>,

    #[account(seeds = [SBT_CONFIG_SEED, &[3u8]], bump = sbt_config_mission.bump)]
    pub sbt_config_mission: Account<'info, SbtConfig>,

    #[account(mut)]
    pub challenge_config: Account<'info, ChallengeConfig>,

    /// CHECK: validated via challenge_config.sft_accepted_mint
    #[account(mut, constraint = sft_accepted_mint.key() == challenge_config.sft_accepted_mint @ SbtError::MintNotCreated)]
    pub sft_accepted_mint: UncheckedAccount<'info>,

    /// CHECK: validated via challenge_config.sft_mission_mint
    #[account(mut, constraint = sft_mission_mint.key() == challenge_config.sft_mission_mint @ SbtError::MintNotCreated)]
    pub sft_mission_mint: UncheckedAccount<'info>,

    /// CHECK: validated via challenge_config.sft_complete_mint
    #[account(mut, constraint = sft_complete_mint.key() == challenge_config.sft_complete_mint @ SbtError::MintNotCreated)]
    pub sft_complete_mint: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
    pub token_2022_program: Program<'info, Token2022>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/update_challenge.rs
git commit -m "feat(sbt): update_challenge propagates metadata to 3 SFT mints"
```

---

### Task 10: mint_event_sbt.rs — mint từ shared SFT mint

**Files:**
- Modify: `programs/sbt_program/src/instructions/mint_event_sbt.rs`

- [ ] Rewrite `mint_event_sbt.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::Token2022};
use crate::{errors::SbtError, state::*, token_utils::mint_sft_to_user};

pub fn handler(ctx: Context<MintEventSbt>, issuer: String) -> Result<()> {
    require!(issuer.len() <= 32, SbtError::IssuerTooLong);
    require!(ctx.accounts.event_config.active, SbtError::NotActive);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    mint_sft_to_user(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        1u8,
        ctx.accounts.sbt_config.bump,
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let now = Clock::get()?.unix_timestamp;
    let event_id = ctx.accounts.event_config.event_id;

    let record = &mut ctx.accounts.sbt_record;
    record.owner = ctx.accounts.recipient.key();
    record.sbt_type = 1;
    record.collection_id = event_id;
    record.mission_index = 0;
    record.issuer = issuer;
    record.issued_at = now;
    record.revoked = false;
    record.bump = ctx.bumps.sbt_record;

    let participation = &mut ctx.accounts.participation_record;
    participation.user = ctx.accounts.recipient.key();
    participation.collection_id = event_id;
    participation.sbt_type = 1;
    participation.mission_index = 0;
    participation.minted_at = now;
    participation.bump = ctx.bumps.participation_record;

    ctx.accounts.event_config.participant_count = ctx.accounts.event_config.participant_count
        .checked_add(1).ok_or(SbtError::Overflow)?;
    ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
        .checked_add(1).ok_or(SbtError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct MintEventSbt<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[1u8]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: shared SFT mint for this event
    #[account(
        mut,
        constraint = sft_mint.key() == event_config.sft_mint @ SbtError::MintNotCreated
    )]
    pub sft_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: recipient wallet
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + SbtRecord::SPACE,
        seeds = [SBT_RECORD_SEED, event_config.event_id.as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    #[account(
        init,
        payer = payer,
        space = 8 + ParticipationRecord::SPACE,
        seeds = [PARTICIPATION_SEED, &[1u8], event_config.event_id.as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub participation_record: Account<'info, ParticipationRecord>,

    /// CHECK: ATA for recipient
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/mint_event_sbt.rs
git commit -m "feat(sbt): mint_event_sbt uses shared SFT mint, new SbtRecord seed"
```

---

### Task 11: mint_challenge_accepted.rs

**Files:**
- Modify: `programs/sbt_program/src/instructions/mint_challenge_accepted.rs`

- [ ] Rewrite `mint_challenge_accepted.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::Token2022};
use crate::{errors::SbtError, state::*, token_utils::mint_sft_to_user};

pub fn handler(ctx: Context<MintChallengeAccepted>, issuer: String) -> Result<()> {
    require!(issuer.len() <= 32, SbtError::IssuerTooLong);
    require!(ctx.accounts.challenge_config.active, SbtError::NotActive);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);

    mint_sft_to_user(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        2u8,
        ctx.accounts.sbt_config.bump,
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let now = Clock::get()?.unix_timestamp;
    let challenge_id = ctx.accounts.challenge_config.challenge_id;

    let record = &mut ctx.accounts.sbt_record;
    record.owner = ctx.accounts.recipient.key();
    record.sbt_type = 2;
    record.collection_id = challenge_id;
    record.mission_index = 0;
    record.issuer = issuer;
    record.issued_at = now;
    record.revoked = false;
    record.bump = ctx.bumps.sbt_record;

    let participation = &mut ctx.accounts.participation_record;
    participation.user = ctx.accounts.recipient.key();
    participation.collection_id = challenge_id;
    participation.sbt_type = 2;
    participation.mission_index = 0;
    participation.minted_at = now;
    participation.bump = ctx.bumps.participation_record;

    ctx.accounts.challenge_config.participant_count = ctx.accounts.challenge_config.participant_count
        .checked_add(1).ok_or(SbtError::Overflow)?;
    ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
        .checked_add(1).ok_or(SbtError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct MintChallengeAccepted<'info> {
    #[account(mut, seeds = [SBT_CONFIG_SEED, &[2u8]], bump = sbt_config.bump)]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub challenge_config: Account<'info, ChallengeConfig>,

    /// CHECK: sft_accepted_mint for this challenge
    #[account(mut, constraint = sft_mint.key() == challenge_config.sft_accepted_mint @ SbtError::MintNotCreated)]
    pub sft_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: recipient wallet
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init, payer = payer, space = 8 + SbtRecord::SPACE,
        seeds = [SBT_RECORD_SEED, challenge_config.challenge_id.as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    #[account(
        init, payer = payer, space = 8 + ParticipationRecord::SPACE,
        seeds = [PARTICIPATION_SEED, &[2u8], challenge_config.challenge_id.as_ref(), &[0u8], recipient.key().as_ref()],
        bump
    )]
    pub participation_record: Account<'info, ParticipationRecord>,

    /// CHECK: ATA for recipient
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/mint_challenge_accepted.rs
git commit -m "feat(sbt): mint_challenge_accepted uses shared sft_accepted_mint"
```

---

### Task 12: mint_challenge_mission.rs

**Files:**
- Modify: `programs/sbt_program/src/instructions/mint_challenge_mission.rs`

- [ ] Rewrite `mint_challenge_mission.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::Token2022};
use crate::{errors::SbtError, state::*, token_utils::mint_sft_to_user};

pub fn handler(ctx: Context<MintChallengeMission>, mission_index: u8, issuer: String) -> Result<()> {
    require!(issuer.len() <= 32, SbtError::IssuerTooLong);
    require!(ctx.accounts.challenge_config.active, SbtError::NotActive);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    require!(
        mission_index < ctx.accounts.challenge_config.total_missions || mission_index == 255,
        SbtError::InvalidMissionIndex
    );

    // Use complete mint for mission_index=255, mission mint otherwise
    let sft_mint_key = if mission_index == 255 {
        ctx.accounts.challenge_config.sft_complete_mint
    } else {
        ctx.accounts.challenge_config.sft_mission_mint
    };
    require_keys_eq!(ctx.accounts.sft_mint.key(), sft_mint_key, SbtError::MintNotCreated);

    mint_sft_to_user(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        3u8,
        ctx.accounts.sbt_config.bump,
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let now = Clock::get()?.unix_timestamp;
    let challenge_id = ctx.accounts.challenge_config.challenge_id;

    let record = &mut ctx.accounts.sbt_record;
    record.owner = ctx.accounts.recipient.key();
    record.sbt_type = 3;
    record.collection_id = challenge_id;
    record.mission_index = mission_index;
    record.issuer = issuer;
    record.issued_at = now;
    record.revoked = false;
    record.bump = ctx.bumps.sbt_record;

    let participation = &mut ctx.accounts.participation_record;
    participation.user = ctx.accounts.recipient.key();
    participation.collection_id = challenge_id;
    participation.sbt_type = 3;
    participation.mission_index = mission_index;
    participation.minted_at = now;
    participation.bump = ctx.bumps.participation_record;

    ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
        .checked_add(1).ok_or(SbtError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(mission_index: u8)]
pub struct MintChallengeMission<'info> {
    #[account(mut, seeds = [SBT_CONFIG_SEED, &[3u8]], bump = sbt_config.bump)]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub challenge_config: Account<'info, ChallengeConfig>,

    /// CHECK: sft_mission_mint or sft_complete_mint — validated in handler
    #[account(mut)]
    pub sft_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: recipient wallet
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init, payer = payer, space = 8 + SbtRecord::SPACE,
        seeds = [SBT_RECORD_SEED, challenge_config.challenge_id.as_ref(), &[mission_index], recipient.key().as_ref()],
        bump
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    #[account(
        init, payer = payer, space = 8 + ParticipationRecord::SPACE,
        seeds = [PARTICIPATION_SEED, &[3u8], challenge_config.challenge_id.as_ref(), &[mission_index], recipient.key().as_ref()],
        bump
    )]
    pub participation_record: Account<'info, ParticipationRecord>,

    /// CHECK: ATA for recipient
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/mint_challenge_mission.rs
git commit -m "feat(sbt): mint_challenge_mission uses shared sft_mission/complete_mint"
```

---

### Task 13: revoke_sbt.rs — individual revoke via PermanentDelegate

**Files:**
- Modify: `programs/sbt_program/src/instructions/revoke_sbt.rs`

- [ ] Rewrite `revoke_sbt.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use crate::{errors::SbtError, state::*, token_utils::revoke_sft_from_user};

pub fn handler(ctx: Context<RevokeSbt>, sbt_type: u8, mission_index: u8) -> Result<()> {
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    require!(!ctx.accounts.sbt_record.revoked, SbtError::AlreadyRevoked);

    revoke_sft_from_user(
        &ctx.accounts.sft_mint.to_account_info(),
        &ctx.accounts.token_account.to_account_info(),
        &ctx.accounts.sbt_config.to_account_info(),
        sbt_type,
        ctx.accounts.sbt_config.bump,
        &ctx.accounts.token_2022_program.to_account_info(),
    )?;

    ctx.accounts.sbt_record.revoked = true;
    msg!("SBT revoked for user: {} collection: {:?} mission: {}",
        ctx.accounts.user.key(), ctx.accounts.sbt_record.collection_id, mission_index);

    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8, mission_index: u8)]
pub struct RevokeSbt<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,

    pub authority: Signer<'info>,

    /// CHECK: user whose SBT is being revoked
    pub user: UncheckedAccount<'info>,

    /// CHECK: shared SFT mint — authority validated via sbt_record
    #[account(mut)]
    pub sft_mint: UncheckedAccount<'info>,

    /// CHECK: user's ATA for this sft_mint
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SBT_RECORD_SEED, sbt_record.collection_id.as_ref(), &[mission_index], user.key().as_ref()],
        bump = sbt_record.bump,
    )]
    pub sbt_record: Account<'info, SbtRecord>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/revoke_sbt.rs
git commit -m "feat(sbt): revoke_sbt uses PermanentDelegate burn on shared SFT mint"
```

---

### Task 14: New instructions — pause_program, batch_mint_event

**Files:**
- Create: `programs/sbt_program/src/instructions/pause_program.rs`
- Create: `programs/sbt_program/src/instructions/batch_mint_event.rs`

- [ ] Create `pause_program.rs`:
```rust
use anchor_lang::prelude::*;
use crate::{errors::SbtError, state::*};

pub fn handler(ctx: Context<PauseProgram>, sbt_type: u8, paused: bool) -> Result<()> {
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    ctx.accounts.sbt_config.paused = paused;
    msg!("SbtConfig type={} paused={}", sbt_type, paused);
    Ok(())
}

#[derive(Accounts)]
#[instruction(sbt_type: u8)]
pub struct PauseProgram<'info> {
    #[account(
        mut,
        seeds = [SBT_CONFIG_SEED, &[sbt_type]],
        bump = sbt_config.bump,
    )]
    pub sbt_config: Account<'info, SbtConfig>,
    pub authority: Signer<'info>,
}
```

- [ ] Create `batch_mint_event.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{create as create_ata, Create as CreateAta, AssociatedToken},
    token_2022::{self, FreezeAccount, MintTo, Token2022},
};
use crate::{errors::SbtError, state::*};

/// Batch mint event SBT to multiple recipients.
/// remaining_accounts layout (per recipient): [recipient_wallet, recipient_ata]
/// No SbtRecord/ParticipationRecord created — use individual mint_event_sbt for those.
/// Admin must ensure no duplicate by checking ATA existence off-chain before calling.
pub fn handler(ctx: Context<BatchMintEvent>) -> Result<()> {
    require!(ctx.accounts.event_config.active, SbtError::NotActive);
    require!(!ctx.accounts.sbt_config.paused, SbtError::ProgramPaused);
    require_keys_eq!(ctx.accounts.sbt_config.authority, ctx.accounts.authority.key(), SbtError::Unauthorized);
    require!(ctx.accounts.sft_mint.key() == ctx.accounts.event_config.sft_mint, SbtError::MintNotCreated);

    let sbt_type = 1u8;
    let config_bump = ctx.accounts.sbt_config.bump;
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    let accounts = ctx.remaining_accounts;
    require!(accounts.len() % 2 == 0, SbtError::Overflow);

    for chunk in accounts.chunks(2) {
        let recipient = &chunk[0];
        let ata = &chunk[1];

        create_ata(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            CreateAta {
                payer: ctx.accounts.authority.to_account_info(),
                associated_token: ata.clone(),
                authority: recipient.clone(),
                mint: ctx.accounts.sft_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_2022_program.to_account_info(),
            },
        ))?;

        token_2022::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.sft_mint.to_account_info(),
                to: ata.clone(),
                authority: ctx.accounts.sbt_config.to_account_info(),
            },
            signer_seeds,
        ), 1)?;

        token_2022::freeze_account(CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            FreezeAccount {
                account: ata.clone(),
                mint: ctx.accounts.sft_mint.to_account_info(),
                authority: ctx.accounts.sbt_config.to_account_info(),
            },
            signer_seeds,
        ))?;

        ctx.accounts.event_config.participant_count = ctx.accounts.event_config.participant_count
            .checked_add(1).ok_or(SbtError::Overflow)?;
        ctx.accounts.sbt_config.sbt_count = ctx.accounts.sbt_config.sbt_count
            .checked_add(1).ok_or(SbtError::Overflow)?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct BatchMintEvent<'info> {
    #[account(mut, seeds = [SBT_CONFIG_SEED, &[1u8]], bump = sbt_config.bump)]
    pub sbt_config: Account<'info, SbtConfig>,

    #[account(mut)]
    pub event_config: Account<'info, EventConfig>,

    /// CHECK: shared SFT mint for this event
    #[account(mut)]
    pub sft_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
```

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/pause_program.rs programs/sbt_program/src/instructions/batch_mint_event.rs
git commit -m "feat(sbt): add pause_program and batch_mint_event instructions"
```

---

### Task 15: sbt_program mod.rs + lib.rs update

**Files:**
- Modify: `programs/sbt_program/src/instructions/mod.rs`
- Modify: `programs/sbt_program/src/lib.rs`

- [ ] Rewrite `programs/sbt_program/src/instructions/mod.rs`:
```rust
pub mod initialize_config;
pub mod create_event;
pub mod update_event;
pub mod create_challenge;
pub mod update_challenge;
pub mod mint_human_capital;
pub mod mint_event_sbt;
pub mod mint_challenge_accepted;
pub mod mint_challenge_mission;
pub mod revoke_sbt;
pub mod verify_sbt;
pub mod transfer_authority;
pub mod close_event;
pub mod close_challenge;
pub mod pause_program;
pub mod batch_mint_event;

pub use initialize_config::*;
pub use create_event::*;
pub use update_event::*;
pub use create_challenge::*;
pub use update_challenge::*;
pub use mint_human_capital::*;
pub use mint_event_sbt::*;
pub use mint_challenge_accepted::*;
pub use mint_challenge_mission::*;
pub use revoke_sbt::*;
pub use verify_sbt::*;
pub use transfer_authority::*;
pub use close_event::*;
pub use close_challenge::*;
pub use pause_program::*;
pub use batch_mint_event::*;
```

- [ ] Rewrite `programs/sbt_program/src/lib.rs` — update signatures:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::associated_token::AssociatedToken;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod token_utils;

use instructions::*;

declare_id!("51G8WL8HZnib5SyV929K2DyqGEMRn89Bx6nJMitsP2QH");

#[program]
pub mod sbt_program {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, sbt_type: u8) -> Result<()> {
        instructions::initialize_config::handler(ctx, sbt_type)
    }
    pub fn create_event(ctx: Context<CreateEvent>, event_id: [u8; 32], name: String, symbol: String, uri: String) -> Result<()> {
        instructions::create_event::handler(ctx, event_id, name, symbol, uri)
    }
    pub fn update_event(ctx: Context<UpdateEvent>, active: bool, name: Option<String>, symbol: Option<String>, uri: Option<String>) -> Result<()> {
        instructions::update_event::handler(ctx, active, name, symbol, uri)
    }
    pub fn create_challenge(ctx: Context<CreateChallenge>, challenge_id: [u8; 32], name: String, symbol: String, uri_accepted: String, uri_mission: String, uri_complete: String, total_missions: u8) -> Result<()> {
        instructions::create_challenge::handler(ctx, challenge_id, name, symbol, uri_accepted, uri_mission, uri_complete, total_missions)
    }
    pub fn update_challenge(ctx: Context<UpdateChallenge>, active: bool, name: Option<String>, symbol: Option<String>, uri_accepted: Option<String>, uri_mission: Option<String>, uri_complete: Option<String>) -> Result<()> {
        instructions::update_challenge::handler(ctx, active, name, symbol, uri_accepted, uri_mission, uri_complete)
    }
    pub fn mint_human_capital(ctx: Context<MintHumanCapital>, name: String, issuer: String, uri: String) -> Result<()> {
        instructions::mint_human_capital::handler(ctx, name, issuer, uri)
    }
    pub fn mint_event_sbt(ctx: Context<MintEventSbt>, issuer: String) -> Result<()> {
        instructions::mint_event_sbt::handler(ctx, issuer)
    }
    pub fn mint_challenge_accepted(ctx: Context<MintChallengeAccepted>, issuer: String) -> Result<()> {
        instructions::mint_challenge_accepted::handler(ctx, issuer)
    }
    pub fn mint_challenge_mission(ctx: Context<MintChallengeMission>, mission_index: u8, issuer: String) -> Result<()> {
        instructions::mint_challenge_mission::handler(ctx, mission_index, issuer)
    }
    pub fn revoke_sbt(ctx: Context<RevokeSbt>, sbt_type: u8, mission_index: u8) -> Result<()> {
        instructions::revoke_sbt::handler(ctx, sbt_type, mission_index)
    }
    pub fn verify_sbt(ctx: Context<VerifySbt>) -> Result<()> {
        instructions::verify_sbt::handler(ctx)
    }
    pub fn transfer_authority(ctx: Context<TransferAuthority>, sbt_type: u8, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::handler(ctx, sbt_type, new_authority)
    }
    pub fn close_event(ctx: Context<CloseEvent>) -> Result<()> {
        instructions::close_event::handler(ctx)
    }
    pub fn close_challenge(ctx: Context<CloseChallenge>) -> Result<()> {
        instructions::close_challenge::handler(ctx)
    }
    pub fn pause_program(ctx: Context<PauseProgram>, sbt_type: u8, paused: bool) -> Result<()> {
        instructions::pause_program::handler(ctx, sbt_type, paused)
    }
    pub fn batch_mint_event(ctx: Context<BatchMintEvent>) -> Result<()> {
        instructions::batch_mint_event::handler(ctx)
    }
}
```

- [ ] Run `anchor build -- -p sbt_program 2>&1 | grep "^error" | head -30` — expect clean or only minor errors.

- [ ] Commit:
```bash
git add programs/sbt_program/src/instructions/mod.rs programs/sbt_program/src/lib.rs
git commit -m "feat(sbt): update mod.rs and lib.rs for SFT refactor"
```

---

## Phase D — nft_program state + new instructions

### Task 16: NftConfig add paused + NftError updates + new state files

**Files:**
- Modify: `programs/nft_program/src/state/nft_config.rs`
- Modify: `programs/nft_program/src/errors.rs`
- Create: `programs/nft_program/src/state/rwa_config.rs`
- Create: `programs/nft_program/src/state/checkpoint_mint.rs`
- Modify: `programs/nft_program/src/state/mod.rs`

- [ ] Edit `nft_config.rs`:
```rust
pub struct NftConfig {
    pub authority: Pubkey,
    pub collection_type: u8,
    pub nft_count: u64,
    pub paused: bool,  // NEW
    pub bump: u8,
}
impl NftConfig {
    pub const SPACE: usize = 32 + 1 + 8 + 1 + 1; // 43
}
```

- [ ] Edit `errors.rs` — thêm vào cuối enum:
```rust
#[msg("Program is paused — contact admin")]
ProgramPaused,
#[msg("SFT mint not created for this collection — call create_rwa_mint or create_stamp_mint first")]
MintNotCreated,
```

- [ ] Create `rwa_config.rs`:
```rust
use anchor_lang::prelude::*;

pub const RWA_CONFIG_SEED: &[u8] = b"rwa_config";

#[account]
pub struct RwaConfig {
    pub challenge_id: [u8; 32],
    pub name: String,        // max 32
    pub symbol: String,      // max 10
    pub uri: String,         // max 200
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
```

- [ ] Create `checkpoint_mint.rs`:
```rust
use anchor_lang::prelude::*;

pub const CHECKPOINT_MINT_SEED: &[u8] = b"checkpoint_mint";

#[account]
pub struct CheckpointMint {
    pub rally_id: [u8; 32],
    pub checkpoint_index: u8,
    pub sft_mint: Pubkey,
    pub bump: u8,
}

impl CheckpointMint {
    pub const SPACE: usize = 32 + 1 + 32 + 1; // 66
}
```

- [ ] Edit `programs/nft_program/src/state/mod.rs` — thêm 2 dòng:
```rust
pub mod rwa_config;
pub mod checkpoint_mint;
pub use rwa_config::*;
pub use checkpoint_mint::*;
```

- [ ] Edit `programs/nft_program/src/instructions/initialize_config.rs` — thêm `config.paused = false;`

- [ ] Commit:
```bash
git add programs/nft_program/src/state/ programs/nft_program/src/errors.rs programs/nft_program/src/instructions/initialize_config.rs
git commit -m "feat(nft): add RwaConfig, CheckpointMint state; NftConfig.paused; ProgramPaused error"
```

---

### Task 17: create_rwa_mint.rs

**Files:**
- Create: `programs/nft_program/src/instructions/create_rwa_mint.rs`

- [ ] Create `create_rwa_mint.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token},
};
use mpl_token_metadata::{
    instructions::{CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs},
    types::{Creator, DataV2},
    ID as METADATA_PROGRAM_ID,
};
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<CreateRwaMint>,
    challenge_id: [u8; 32],
    name: String,
    symbol: String,
    uri: String,
    royalty: u16,
) -> Result<()> {
    require!(name.len() <= 32, NftError::NameTooLong);
    require!(symbol.len() <= 10, NftError::SymbolTooLong);
    require!(uri.len() <= 200, NftError::UriTooLong);
    require!(royalty <= 10_000, NftError::InvalidRoyalty);
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);

    let creators = vec![Creator {
        address: ctx.accounts.authority.key(),
        verified: true,
        share: 100,
    }];

    let metadata_ix = CreateMetadataAccountV3 {
        metadata: ctx.accounts.metadata.key(),
        mint: ctx.accounts.mint.key(),
        mint_authority: ctx.accounts.authority.key(),
        payer: ctx.accounts.authority.key(),
        update_authority: (ctx.accounts.authority.key(), true),
        system_program: ctx.accounts.system_program.key(),
        rent: Some(ctx.accounts.rent.key()),
    }.instruction(CreateMetadataAccountV3InstructionArgs {
        data: DataV2 {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            seller_fee_basis_points: royalty,
            creators: Some(creators),
            collection: None,
            uses: None,
        },
        is_mutable: true,
        collection_details: None,
    });

    invoke(&metadata_ix, &[
        ctx.accounts.metadata.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ])?;

    let config = &mut ctx.accounts.rwa_config;
    config.challenge_id = challenge_id;
    config.name = name;
    config.symbol = symbol;
    config.uri = uri;
    config.royalty = royalty;
    config.sft_mint = ctx.accounts.mint.key();
    config.authority = ctx.accounts.authority.key();
    config.participant_count = 0;
    config.active = true;
    config.bump = ctx.bumps.rwa_config;

    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct CreateRwaMint<'info> {
    #[account(seeds = [NFT_CONFIG_SEED, &[0u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + RwaConfig::SPACE,
        seeds = [RWA_CONFIG_SEED, &challenge_id],
        bump,
    )]
    pub rwa_config: Account<'info, RwaConfig>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = authority,
        mint::freeze_authority = authority,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Metaplex metadata PDA
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
        constraint = metadata.data_is_empty() @ NftError::MetadataAlreadyExists
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex program
    #[account(address = METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/nft_program/src/instructions/create_rwa_mint.rs
git commit -m "feat(nft): add create_rwa_mint — creates shared SPL mint + Metaplex metadata for RWA type"
```

---

### Task 18: create_stamp_mint.rs

**Files:**
- Create: `programs/nft_program/src/instructions/create_stamp_mint.rs`

- [ ] Create `create_stamp_mint.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token::{Mint, Token};
use mpl_token_metadata::{
    instructions::{CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs},
    types::DataV2,
    ID as METADATA_PROGRAM_ID,
};
use crate::{errors::NftError, state::*};

pub fn handler(
    ctx: Context<CreateStampMint>,
    checkpoint_index: u8,
) -> Result<()> {
    require!(ctx.accounts.rally_config.active, NftError::NotActive);
    require!(
        checkpoint_index < ctx.accounts.rally_config.total_checkpoints || checkpoint_index == 255,
        NftError::InvalidCheckpointIndex
    );
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);

    let uri = if checkpoint_index == 255 {
        ctx.accounts.rally_config.uri_complete.clone()
    } else {
        ctx.accounts.rally_config.uri_stamp.clone()
    };
    let name = if checkpoint_index == 255 {
        format!("{} Complete", ctx.accounts.rally_config.name)
    } else {
        format!("{} #{}", ctx.accounts.rally_config.name, checkpoint_index + 1)
    };

    let metadata_ix = CreateMetadataAccountV3 {
        metadata: ctx.accounts.metadata.key(),
        mint: ctx.accounts.mint.key(),
        mint_authority: ctx.accounts.authority.key(),
        payer: ctx.accounts.authority.key(),
        update_authority: (ctx.accounts.authority.key(), true),
        system_program: ctx.accounts.system_program.key(),
        rent: Some(ctx.accounts.rent.key()),
    }.instruction(CreateMetadataAccountV3InstructionArgs {
        data: DataV2 {
            name,
            symbol: ctx.accounts.rally_config.symbol.clone(),
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        is_mutable: true,
        collection_details: None,
    });

    invoke(&metadata_ix, &[
        ctx.accounts.metadata.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ])?;

    let cp = &mut ctx.accounts.checkpoint_mint;
    cp.rally_id = ctx.accounts.rally_config.rally_id;
    cp.checkpoint_index = checkpoint_index;
    cp.sft_mint = ctx.accounts.mint.key();
    cp.bump = ctx.bumps.checkpoint_mint;

    Ok(())
}

#[derive(Accounts)]
#[instruction(checkpoint_index: u8)]
pub struct CreateStampMint<'info> {
    #[account(seeds = [NFT_CONFIG_SEED, &[1u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(seeds = [RALLY_CONFIG_SEED, rally_config.rally_id.as_ref()], bump = rally_config.bump)]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + CheckpointMint::SPACE,
        seeds = [CHECKPOINT_MINT_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index]],
        bump,
    )]
    pub checkpoint_mint: Account<'info, CheckpointMint>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = authority,
        mint::freeze_authority = authority,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Metaplex metadata PDA
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
        constraint = metadata.data_is_empty() @ NftError::MetadataAlreadyExists
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex program
    #[account(address = METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/nft_program/src/instructions/create_stamp_mint.rs
git commit -m "feat(nft): add create_stamp_mint — creates shared SPL mint + Metaplex metadata per checkpoint"
```

---

### Task 19: mint_rwa.rs rewrite

**Files:**
- Modify: `programs/nft_program/src/instructions/mint_rwa.rs`

- [ ] Rewrite `mint_rwa.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, MintTo, Token, TokenAccount},
};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<MintRwa>, challenge_id: [u8; 32]) -> Result<()> {
    require!(ctx.accounts.rwa_config.active, NftError::NotActive);
    require!(!ctx.accounts.nft_config.paused, NftError::ProgramPaused);
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);

    // Mint 1 token from shared RWA mint to recipient's ATA
    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        1,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let issuance = &mut ctx.accounts.rwa_issuance;
    issuance.challenge_id = challenge_id;
    issuance.user = ctx.accounts.recipient.key();
    issuance.minted_at = now;
    issuance.bump = ctx.bumps.rwa_issuance;

    ctx.accounts.rwa_config.participant_count = ctx.accounts.rwa_config.participant_count
        .checked_add(1).ok_or(NftError::Overflow)?;
    ctx.accounts.nft_config.nft_count = ctx.accounts.nft_config.nft_count
        .checked_add(1).ok_or(NftError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(challenge_id: [u8; 32])]
pub struct MintRwa<'info> {
    #[account(mut, seeds = [NFT_CONFIG_SEED, &[0u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(
        mut,
        seeds = [RWA_CONFIG_SEED, &challenge_id],
        bump = rwa_config.bump,
    )]
    pub rwa_config: Account<'info, RwaConfig>,

    /// CHECK: shared RWA mint from rwa_config.sft_mint
    #[account(
        mut,
        constraint = mint.key() == rwa_config.sft_mint @ NftError::MintNotCreated
    )]
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RwaIssuance::SPACE,
        seeds = [RWA_ISSUANCE_SEED, &challenge_id, recipient.key().as_ref()],
        bump,
    )]
    pub rwa_issuance: Account<'info, RwaIssuance>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/nft_program/src/instructions/mint_rwa.rs
git commit -m "feat(nft): mint_rwa uses shared RWA SFT mint from RwaConfig"
```

---

### Task 20: mint_stamp.rs rewrite

**Files:**
- Modify: `programs/nft_program/src/instructions/mint_stamp.rs`

- [ ] Rewrite `mint_stamp.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, MintTo, Token, TokenAccount},
};
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<MintStamp>, checkpoint_index: u8) -> Result<()> {
    require!(ctx.accounts.rally_config.active, NftError::NotActive);
    require!(!ctx.accounts.nft_config.paused, NftError::ProgramPaused);
    require!(
        checkpoint_index < ctx.accounts.rally_config.total_checkpoints || checkpoint_index == 255,
        NftError::InvalidCheckpointIndex
    );
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);
    require!(
        ctx.accounts.checkpoint_mint_account.sft_mint == ctx.accounts.mint.key(),
        NftError::MintNotCreated
    );

    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        1,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let participation = &mut ctx.accounts.stamp_participation;
    participation.user = ctx.accounts.recipient.key();
    participation.rally_id = ctx.accounts.rally_config.rally_id;
    participation.checkpoint_index = checkpoint_index;
    participation.minted_at = now;
    participation.bump = ctx.bumps.stamp_participation;

    ctx.accounts.nft_config.nft_count = ctx.accounts.nft_config.nft_count
        .checked_add(1).ok_or(NftError::Overflow)?;
    ctx.accounts.rally_config.participant_count = ctx.accounts.rally_config.participant_count
        .checked_add(1).ok_or(NftError::Overflow)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(checkpoint_index: u8)]
pub struct MintStamp<'info> {
    #[account(mut, seeds = [NFT_CONFIG_SEED, &[1u8]], bump = nft_config.bump)]
    pub nft_config: Account<'info, NftConfig>,

    #[account(mut, seeds = [RALLY_CONFIG_SEED, rally_config.rally_id.as_ref()], bump = rally_config.bump)]
    pub rally_config: Account<'info, RallyConfig>,

    #[account(
        seeds = [CHECKPOINT_MINT_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index]],
        bump = checkpoint_mint_account.bump,
    )]
    pub checkpoint_mint_account: Account<'info, CheckpointMint>,

    /// CHECK: shared mint for this checkpoint — validated via checkpoint_mint_account.sft_mint
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + StampParticipation::SPACE,
        seeds = [STAMP_PARTICIPATION_SEED, rally_config.rally_id.as_ref(), &[checkpoint_index], recipient.key().as_ref()],
        bump,
    )]
    pub stamp_participation: Account<'info, StampParticipation>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
```

- [ ] Commit:
```bash
git add programs/nft_program/src/instructions/mint_stamp.rs
git commit -m "feat(nft): mint_stamp uses shared CheckpointMint SFT"
```

---

### Task 21: nft_program — pause_program + mod.rs + lib.rs

**Files:**
- Create: `programs/nft_program/src/instructions/pause_program.rs`
- Modify: `programs/nft_program/src/instructions/mod.rs`
- Modify: `programs/nft_program/src/lib.rs`

- [ ] Create `programs/nft_program/src/instructions/pause_program.rs`:
```rust
use anchor_lang::prelude::*;
use crate::{errors::NftError, state::*};

pub fn handler(ctx: Context<PauseProgram>, collection_type: u8, paused: bool) -> Result<()> {
    require!(ctx.accounts.nft_config.authority == ctx.accounts.authority.key(), NftError::Unauthorized);
    ctx.accounts.nft_config.paused = paused;
    msg!("NftConfig type={} paused={}", collection_type, paused);
    Ok(())
}

#[derive(Accounts)]
#[instruction(collection_type: u8)]
pub struct PauseProgram<'info> {
    #[account(
        mut,
        seeds = [NFT_CONFIG_SEED, &[collection_type]],
        bump = nft_config.bump,
    )]
    pub nft_config: Account<'info, NftConfig>,
    pub authority: Signer<'info>,
}
```

- [ ] Rewrite `programs/nft_program/src/instructions/mod.rs`:
```rust
pub mod initialize_config;
pub mod create_rally;
pub mod update_rally;
pub mod create_rwa_mint;
pub mod create_stamp_mint;
pub mod mint_rwa;
pub mod mint_stamp;
pub mod use_rwa;
pub mod transfer_authority;
pub mod burn_rwa;
pub mod burn_stamp;
pub mod close_rally;
pub mod pause_program;

pub use initialize_config::*;
pub use create_rally::*;
pub use update_rally::*;
pub use create_rwa_mint::*;
pub use create_stamp_mint::*;
pub use mint_rwa::*;
pub use mint_stamp::*;
pub use use_rwa::*;
pub use transfer_authority::*;
pub use burn_rwa::*;
pub use burn_stamp::*;
pub use close_rally::*;
pub use pause_program::*;
```

- [ ] Rewrite `programs/nft_program/src/lib.rs`:
```rust
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Hd9Bnkfs4ib9wV71fi8ica9skTZQ1ZciWe4RrhYP5mVY");

#[program]
pub mod nft_program {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, collection_type: u8) -> Result<()> {
        instructions::initialize_config::handler(ctx, collection_type)
    }
    pub fn create_rally(ctx: Context<CreateRally>, rally_id: [u8; 32], name: String, symbol: String, uri_stamp: String, uri_complete: String, total_checkpoints: u8) -> Result<()> {
        instructions::create_rally::handler(ctx, rally_id, name, symbol, uri_stamp, uri_complete, total_checkpoints)
    }
    pub fn update_rally(ctx: Context<UpdateRally>, active: bool, name: Option<String>, symbol: Option<String>, uri_stamp: Option<String>, uri_complete: Option<String>) -> Result<()> {
        instructions::update_rally::handler(ctx, active, name, symbol, uri_stamp, uri_complete)
    }
    pub fn create_rwa_mint(ctx: Context<CreateRwaMint>, challenge_id: [u8; 32], name: String, symbol: String, uri: String, royalty: u16) -> Result<()> {
        instructions::create_rwa_mint::handler(ctx, challenge_id, name, symbol, uri, royalty)
    }
    pub fn create_stamp_mint(ctx: Context<CreateStampMint>, checkpoint_index: u8) -> Result<()> {
        instructions::create_stamp_mint::handler(ctx, checkpoint_index)
    }
    pub fn mint_rwa(ctx: Context<MintRwa>, challenge_id: [u8; 32]) -> Result<()> {
        instructions::mint_rwa::handler(ctx, challenge_id)
    }
    pub fn mint_stamp(ctx: Context<MintStamp>, checkpoint_index: u8) -> Result<()> {
        instructions::mint_stamp::handler(ctx, checkpoint_index)
    }
    pub fn use_rwa(ctx: Context<UseRwa>) -> Result<()> {
        instructions::use_rwa::handler(ctx)
    }
    pub fn transfer_authority(ctx: Context<TransferAuthority>, collection_type: u8, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::handler(ctx, collection_type, new_authority)
    }
    pub fn burn_rwa(ctx: Context<BurnRwa>) -> Result<()> {
        instructions::burn_rwa::handler(ctx)
    }
    pub fn burn_stamp(ctx: Context<BurnStamp>) -> Result<()> {
        instructions::burn_stamp::handler(ctx)
    }
    pub fn close_rally(ctx: Context<CloseRally>) -> Result<()> {
        instructions::close_rally::handler(ctx)
    }
    pub fn pause_program(ctx: Context<PauseProgram>, collection_type: u8, paused: bool) -> Result<()> {
        instructions::pause_program::handler(ctx, collection_type, paused)
    }
}
```

- [ ] Run `anchor build 2>&1 | grep "^error" | head -30` — expect clean build.

- [ ] Commit:
```bash
git add programs/nft_program/src/instructions/pause_program.rs programs/nft_program/src/instructions/mod.rs programs/nft_program/src/lib.rs
git commit -m "feat(nft): add pause_program, update mod.rs + lib.rs for SFT refactor"
```

---

## Phase E — Build verification

### Task 22: Full build check + fix compilation errors

- [ ] Run `cd /home/binh/Desktop/NFT-SBT && anchor build 2>&1 | tail -30`

- [ ] Fix any remaining compilation errors. Common expected issues:
  - `verify_sbt.rs` may reference old SbtRecord fields → update to use new fields
  - `close_event.rs` / `close_challenge.rs` may reference old EventConfig/ChallengeConfig seeds → verify still correct
  - `burn_rwa.rs` / `burn_stamp.rs` may reference old mint accounts → verify still correct (these use the actual mint from the token_account, not the config, so should be fine)
  - `transfer_authority.rs` in both programs → should not need changes

- [ ] Run `anchor build 2>&1 | grep "Finished\|error\[" | head -20`
  Expected: `Finished release [optimized] target(s)`

- [ ] Commit any fixes:
```bash
git add programs/
git commit -m "fix(build): resolve compilation errors after SFT refactor"
```

---

## Phase F — Tests update

### Task 23: Update tests/sbt.ts

**Files:**
- Modify: `tests/sbt.ts`

- [ ] Rewrite `tests/sbt.ts` with new test flows. Key changes:
  - `create_event` now requires `sft_mint: Keypair` as additional signer
  - `mint_event_sbt` no longer requires `mint` signer, uses `sft_mint` from EventConfig
  - `mint_event_sbt` drops `name` param, signature is `(issuer)`
  - `mint_challenge_accepted` drops `name` param
  - `mint_challenge_mission` drops `name` param
  - `revoke_sbt` signature is `(sbt_type, mission_index)` and requires `user`, `sft_mint`, `token_account`
  - SbtRecord seed changes: `[sbt_record, collection_id, mission_index, user]`
  - Add tests for `pause_program`, `batch_mint_event`

- [ ] Ensure all describe blocks still exist:
  - `initialize_config` (4 types)
  - `create_event` + `update_event`
  - `mint_event_sbt` (including dedup guard)
  - `batch_mint_event`
  - `create_challenge` + `update_challenge`
  - `mint_challenge_accepted` + `mint_challenge_mission`
  - `revoke_sbt` (individual)
  - `pause_program`
  - `transfer_authority (sbt)`
  - `close_event` + `close_challenge`
  - `mint_human_capital` (unchanged)

- [ ] Run `anchor test 2>&1 | tail -40`

- [ ] Commit:
```bash
git add tests/sbt.ts
git commit -m "test(sbt): update test suite for SFT refactor"
```

---

### Task 24: Update tests/nft.ts

**Files:**
- Modify: `tests/nft.ts`

- [ ] Update `tests/nft.ts` key flow changes:
  - Add `create_rwa_mint` before `mint_rwa`
  - Add `create_stamp_mint(checkpoint_index)` before `mint_stamp`
  - `mint_rwa` drops name/symbol/uri/royalty params, only needs `challenge_id`
  - `mint_stamp` drops name/symbol/royalty params, only needs `checkpoint_index`
  - Add tests for `pause_program`

- [ ] Run `anchor test 2>&1 | tail -40`

- [ ] Commit:
```bash
git add tests/nft.ts
git commit -m "test(nft): update test suite for SFT refactor"
```

---

## Phase G — Documentation

### Task 25: Update INSTRUCT.md

- [ ] Update INSTRUCT.md to reflect new instruction signatures and new state accounts (RwaConfig, CheckpointMint)

- [ ] Commit:
```bash
git add INSTRUCT.md
git commit -m "docs: update INSTRUCT.md for SFT refactor"
```

---

## Summary: Gas/Rent Savings

| Category | Before | After | Saving |
|---|---|---|---|
| SbtRecord space | 416 bytes | 112 bytes | 304 bytes = ~0.002 SOL/record |
| Event SBT mint account | 236 bytes × N users | 236 bytes × 1 | ~0.0016 SOL × (N-1) |
| Challenge mints | 236 bytes × 3N users | 236 bytes × 3 | ~0.0016 SOL × 3(N-1) |
| Stamp mint | 82 bytes × N users | 82 bytes × 1 per checkpoint | ~0.0006 SOL × (N-1) |
| Metaplex metadata (stamp) | 679 bytes × N users | 679 bytes × 1 per checkpoint | ~0.005 SOL × (N-1) |

At 1,000 users per event: ~3.2 SOL saved per event. At 10,000 users: ~32 SOL saved.
