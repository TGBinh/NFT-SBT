# Tổng Quan Dự Án NFT-SBT

> Tài liệu này mô tả toàn bộ kiến trúc, thiết kế, và cách tương tác của hệ thống. Đọc từ đầu đến cuối để nắm project từ con số 0.

---

## 1. Dự Án Là Gì?

Đây là một **hệ thống token kép trên Solana** gồm hai chương trình Anchor:

| Chương trình | Program ID (Devnet) | Mục đích |
|---|---|---|
| `nft_program` | `Hd9Bnkfs4ib9wV71fi8ica9skTZQ1ZciWe4RrhYP5mVY` | NFT transferable — RWA và Stamp Rally |
| `sbt_program` | `51G8WL8HZnib5SyV929K2DyqGEMRn89Bx6nJMitsP2QH` | Soulbound Token — không thể chuyển nhượng |

Cả hai chương trình đều dùng mô hình **SFT (Semi-Fungible Token)**: một mint account dùng chung cho cả collection, mỗi user nhận 1 token từ mint đó về ATA (Associated Token Account) của mình.

---

## 2. Hai Chương Trình — Hai Token Standard

### 2.1 nft_program — Dùng SPL Token (legacy)

Token **transferable**, dùng chuẩn Metaplex cho metadata.

**Hai collection:**

| Collection | Loại | Mô tả |
|---|---|---|
| **RWA** (Real World Asset) | `collection_type = 0` | Token đại diện tài sản thực. Mỗi challenge có 1 mint chung. User có thể nhận, dùng (`use_rwa`), hoặc burn. |
| **Stamp Rally** | `collection_type = 1` | Hệ thống rally theo checkpoint. Mỗi checkpoint trong rally có 1 mint chung. User thu thập stamp tại từng checkpoint. |

### 2.2 sbt_program — Dùng Token-2022

Token **không thể chuyển nhượng** (Soulbound), dùng các extension của Token-2022.

**Bốn loại SBT:**

| Loại | `sbt_type` | Mint model | Mô tả |
|---|---|---|---|
| **HumanCapital** | `0` | Unique per user | Mỗi user có 1 mint riêng. Đại diện danh tính/năng lực cá nhân. |
| **Event** | `1` | Shared SFT mint | 1 mint chung cho toàn bộ event. Mỗi participant nhận 1 token. |
| **ChallengeAccepted** | `2` | Shared SFT mint | Nhận khi chấp nhận challenge. |
| **ChallengeMission** | `3` | Shared SFT mint (×2) | Một mint cho "in progress", một mint cho "complete" (mission_index=255). |

---

## 3. Kiến Trúc Kỹ Thuật

### 3.1 Mô Hình SFT — Shared Mint

```
        Authority
           │
           ▼
   [MintAccount] ← 1 mint cho cả collection
       /    \
      /      \
  [ATA_A]  [ATA_B]   ← mỗi user có ATA riêng
  balance=1  balance=1
```

**Ưu điểm:** Giảm số lượng account on-chain. Thay vì N users × 1 mint = N mint, chỉ cần 1 mint + N ATA.

**NFT (SPL Token):** ATA được giữ mở — user có thể chuyển token.
**SBT (Token-2022):** ATA bị **freeze** ngay sau khi mint — không ai có thể chuyển, kể cả user.

### 3.2 Token-2022 Extensions (chỉ SBT)

Mỗi SBT mint được khởi tạo với 4 extension theo đúng thứ tự:

```
1. MetadataPointer   → trỏ vào chính mint này để lưu metadata
2. NonTransferable   → chặn tất cả lệnh transfer
3. PermanentDelegate → SbtConfig PDA có quyền thaw/burn bất kỳ ATA nào
4. TokenMetadata     → lưu name/symbol/uri trực tiếp trong mint account
```

**PermanentDelegate** là chìa khóa revocation: vì ATA bị freeze, user không thể tự burn. SbtConfig PDA (program-owned) có thể thay quyền, dùng `thaw → burn` để thu hồi SBT.

### 3.3 PDA (Program Derived Address) — Toàn Bộ Bảng Seed

Tất cả state account đều là PDA, tức là địa chỉ xác định từ seeds — không cần lưu trữ riêng.

**nft_program:**

| Account | Seed | Dữ liệu chính |
|---|---|---|
| `NftConfig` | `["nft_config", collection_type]` | authority, paused, nft_count |
| `RallyConfig` | `["rally_config", rally_id(32b)]` | name, symbol, uri_stamp, uri_complete, total_checkpoints |
| `RwaConfig` | `["rwa_config", challenge_id(32b)]` | sft_mint, participant_count, active |
| `CheckpointMint` | `["checkpoint_mint", rally_id, checkpoint_index]` | sft_mint (shared mint cho checkpoint đó) |
| `RwaIssuance` | `["rwa_issuance", challenge_id, user]` | minted_at, is_used, used_at |
| `StampParticipation` | `["stamp_participation", rally_id, checkpoint_index, user]` | minted_at |

**sbt_program:**

| Account | Seed | Dữ liệu chính |
|---|---|---|
| `SbtConfig` | `["sbt_config", sbt_type]` | authority, paused, sbt_count |
| `EventConfig` | `["event_config", event_id(32b)]` | sft_mint, participant_count, active |
| `ChallengeConfig` | `["challenge_config", challenge_id(32b)]` | sft_accepted_mint, sft_mission_mint, sft_complete_mint |
| `SbtRecord` | `["sbt_record", collection_id(32b), mission_index, user]` | owner, sbt_type, issuer, issued_at, revoked |
| `ParticipationRecord` | `["participation", sbt_type, collection_id(32b), mission_index, user]` | user, minted_at |

> **HumanCapital đặc biệt:** `collection_id = mint.key().to_bytes()` — mint pubkey làm collection_id nên mỗi user có `SbtRecord` với collection_id khác nhau, đảm bảo uniqueness.

---

## 4. nft_program — Chi Tiết Từng Instruction

### RWA Flow

```
initializeConfig(0)
      │
      ▼
createRwaMint(challenge_id, name, symbol, uri, royalty)
      │  ← tạo shared SPL Token mint + Metaplex metadata + RwaConfig PDA
      ▼
mintRwa(challenge_id)           [per user]
      │  ← tạo ATA cho user, mint 1 token, tạo RwaIssuance PDA
      ▼
useRwa(challenge_id)            [optional]
      │  ← đánh dấu is_used=true trong RwaIssuance
      ▼
burnRwa(challenge_id)           [optional]
      │  ← burn token, đóng ATA, đóng RwaIssuance PDA
```

### Stamp Rally Flow

```
initializeConfig(1)
      │
      ▼
createRally(rally_id, name, symbol, uri_stamp, uri_complete, total_checkpoints)
      │  ← tạo RallyConfig PDA
      ▼
createStampMint(checkpoint_index)    [mỗi checkpoint 1 lần]
      │  ← tạo shared SPL Token mint cho checkpoint đó, tạo CheckpointMint PDA
      ▼
mintStamp(checkpoint_index)          [per user]
      │  ← tạo ATA cho user, mint 1 token, tạo StampParticipation PDA
      ▼
burnStamp(checkpoint_index)          [optional]
      │  ← burn token, đóng ATA, đóng StampParticipation PDA
```

### Quản Trị

| Instruction | Mô tả |
|---|---|
| `updateRally` | Sửa name/symbol/URI, bật/tắt active |
| `transferAuthority` | Chuyển quyền admin sang wallet khác |
| `closeRally` | Đóng rally (phải deactivate trước) |
| `pauseProgram` | Tạm dừng toàn bộ minting |

---

## 5. sbt_program — Chi Tiết Từng Instruction

### HumanCapital Flow (type=0, unique per user)

```
initializeConfig(0)
      │
      ▼
mintHumanCapital(name, issuer, uri)   [per user]
      │  ← tạo mint mới (unique), NonTransferable+PermanentDelegate
      │  ← mint 1 token, xóa mint authority, freeze ATA
      │  ← tạo SbtRecord + ParticipationRecord
```

### Event SBT Flow (type=1, shared mint)

```
initializeConfig(1)
      │
      ▼
createEvent(event_id, name, symbol, uri)
      │  ← tạo shared Token-2022 SFT mint (4 extensions) + EventConfig PDA
      ▼
mintEventSbt(event_id)                [per user]
      │  ← tạo ATA, mint 1 token, freeze ATA
      │  ← tạo SbtRecord + ParticipationRecord
      ▼
batchMintEvent(event_id)             [bulk, tối đa ~20 recipients qua remaining_accounts]
      │  ← mint cho nhiều user trong 1 transaction (không tạo SbtRecord)
      ▼
updateEvent(event_id, name?, symbol?, uri?)    [optional]
      │  ← cập nhật TokenMetadata field trực tiếp trên mint
```

### Challenge SBT Flow (type=2 & 3, 3 shared mints)

```
initializeConfig(2)   initializeConfig(3)
         \               /
          ▼             ▼
createChallenge(challenge_id, name, symbol, uri_accepted, uri_mission, uri_complete, total_missions)
      │  ← tạo 3 mint cùng lúc:
      │     sft_accepted_mint  (type=2) — "{name} Accepted"
      │     sft_mission_mint   (type=3) — "{name} Mission"
      │     sft_complete_mint  (type=3) — "{name} Complete"
      │  ← tạo ChallengeConfig PDA
      │
      ├─→ mintChallengeAccepted(challenge_id)     ← user chấp nhận challenge
      │       tạo SbtRecord (collection_id=challenge_id, mission_index=0)
      │
      ├─→ mintChallengeMission(challenge_id, mission_index)  ← hoàn thành từng mission
      │       mission_index = 0..total_missions-1 → dùng sft_mission_mint
      │       mission_index = 255                 → dùng sft_complete_mint (all done)
      │
      └─→ updateChallenge(challenge_id, ...)       ← cập nhật metadata
```

### Revocation & Verification

```
revokeSbt(sbt_type, mission_index)
      │  ← SbtConfig PDA: thaw ATA → burn 1 token
      │  ← set sbt_record.revoked = true
      ▼
verifySbt(collection_id, mission_index)  [read-only]
      │  ← kiểm tra sbt_record.revoked == false
      │  ← kiểm tra sbt_record.owner == signer
```

---

## 6. Cấu Trúc Thư Mục

```
NFT-SBT/
│
├── Anchor.toml              # Cấu hình workspace: program IDs, cluster, test command
├── Cargo.toml               # Rust workspace, build profile (LTO=fat, overflow checks)
├── package.json             # Scripts: test, build, deploy, mint:nft, mint:sbt
├── tsconfig.json            # TypeScript: ES2020, strict, CommonJS
│
├── programs/
│   ├── nft_program/
│   │   └── src/
│   │       ├── lib.rs                      # Entry point: khai báo 13 instructions
│   │       ├── errors.rs                   # 14 custom errors (NftError)
│   │       ├── state/
│   │       │   ├── mod.rs                  # Re-export tất cả state modules
│   │       │   ├── nft_config.rs           # NftConfig struct + NFT_CONFIG_SEED
│   │       │   ├── rally_config.rs         # RallyConfig struct + RALLY_CONFIG_SEED
│   │       │   ├── rwa_config.rs           # RwaConfig struct + RWA_CONFIG_SEED
│   │       │   ├── rwa_issuance.rs         # RwaIssuance struct + RWA_ISSUANCE_SEED
│   │       │   ├── checkpoint_mint.rs      # CheckpointMint struct + CHECKPOINT_MINT_SEED
│   │       │   └── stamp_participation.rs  # StampParticipation struct + STAMP_PARTICIPATION_SEED
│   │       └── instructions/
│   │           ├── mod.rs                  # Re-export tất cả instruction modules
│   │           ├── initialize_config.rs    # Tạo NftConfig PDA
│   │           ├── create_rally.rs         # Tạo RallyConfig PDA
│   │           ├── update_rally.rs         # Cập nhật RallyConfig
│   │           ├── create_rwa_mint.rs      # Tạo shared SPL mint + Metaplex metadata + RwaConfig
│   │           ├── create_stamp_mint.rs    # Tạo shared SPL mint + CheckpointMint cho 1 checkpoint
│   │           ├── mint_rwa.rs             # Mint RWA token → user ATA + RwaIssuance PDA
│   │           ├── mint_stamp.rs           # Mint Stamp token → user ATA + StampParticipation PDA
│   │           ├── use_rwa.rs              # Đánh dấu RWA đã dùng (is_used flag)
│   │           ├── burn_rwa.rs             # Burn RWA token, đóng ATA + RwaIssuance
│   │           ├── burn_stamp.rs           # Burn Stamp token, đóng ATA + StampParticipation
│   │           ├── transfer_authority.rs   # Chuyển authority sang wallet mới
│   │           ├── close_rally.rs          # Đóng rally (phải deactivate trước)
│   │           └── pause_program.rs        # Bật/tắt global pause
│   │
│   └── sbt_program/
│       └── src/
│           ├── lib.rs                      # Entry point: khai báo 15 instructions
│           ├── errors.rs                   # 14 custom errors (SbtError)
│           ├── token_utils.rs              # 5 helper functions cho Token-2022 operations
│           ├── state/
│           │   ├── mod.rs                  # Re-export tất cả state modules
│           │   ├── sbt_config.rs           # SbtConfig struct + SBT_CONFIG_SEED
│           │   ├── event_config.rs         # EventConfig struct + EVENT_CONFIG_SEED
│           │   ├── challenge_config.rs     # ChallengeConfig struct + CHALLENGE_CONFIG_SEED
│           │   ├── sbt_record.rs           # SbtRecord struct + SBT_RECORD_SEED
│           │   └── participation_record.rs # ParticipationRecord struct + PARTICIPATION_SEED
│           └── instructions/
│               ├── mod.rs                  # Re-export tất cả instruction modules
│               ├── initialize_config.rs    # Tạo SbtConfig PDA (gọi 4 lần cho type 0-3)
│               ├── create_event.rs         # Tạo shared Token-2022 SFT mint + EventConfig
│               ├── update_event.rs         # Cập nhật EventConfig và TokenMetadata fields
│               ├── create_challenge.rs     # Tạo 3 shared mints + ChallengeConfig
│               ├── update_challenge.rs     # Cập nhật ChallengeConfig
│               ├── mint_human_capital.rs   # Unique mint per user (HumanCapital)
│               ├── mint_event_sbt.rs       # Mint từ shared event mint → user ATA (frozen)
│               ├── mint_challenge_accepted.rs  # Mint ChallengeAccepted SBT
│               ├── mint_challenge_mission.rs   # Mint Mission hoặc Complete SBT
│               ├── batch_mint_event.rs     # Bulk mint cho nhiều recipients cùng lúc
│               ├── revoke_sbt.rs           # Thu hồi SBT (thaw + burn qua PermanentDelegate)
│               ├── verify_sbt.rs           # Kiểm tra SBT hợp lệ (read-only)
│               ├── transfer_authority.rs   # Chuyển authority
│               ├── close_event.rs          # Đóng EventConfig (phải deactivate trước)
│               ├── close_challenge.rs      # Đóng ChallengeConfig
│               └── pause_program.rs        # Bật/tắt global pause
│
├── tests/
│   ├── nft.ts               # Test suite cho nft_program (Mocha + Chai)
│   └── sbt.ts               # Test suite cho sbt_program (Mocha + Chai)
│
└── scripts/
    ├── deploy.ts            # Deploy cả 2 program lên devnet, in program IDs
    ├── mint-nft.ts          # Demo: initializeConfig → createRwaMint → mintRwa
    └── mint-sbt.ts          # Demo: initializeConfig(0) → mintHumanCapital
```

---

## 7. token_utils.rs — Thư Viện Token-2022

File này chứa tất cả logic liên quan đến Token-2022 CPI (Cross-Program Invocation), tách ra khỏi instructions để tái dùng:

| Function | Mô tả |
|---|---|
| `create_sft_mint` | Tạo shared SFT mint với 4 extensions. SbtConfig PDA là mint authority, freeze authority, và permanent delegate. Sequence: allocate → MetadataPointer → NonTransferable → PermanentDelegate → initialize_mint2 → init_metadata |
| `mint_sft_to_user` | Tạo ATA → mint 1 token → freeze ATA. SbtConfig PDA ký bằng seeds. |
| `revoke_sft_from_user` | Thaw ATA → burn 1 token. PermanentDelegate (SbtConfig) ký — không cần user ký. |
| `update_sft_metadata_field` | Cập nhật name/symbol/uri trực tiếp trong TokenMetadata của mint. |
| `mint_sbt_token` | **HumanCapital only** — tạo unique mint per user, xóa mint authority (supply lock = 1), freeze ATA, chuyển freeze authority về SbtConfig PDA. |

---

## 8. Errors

### nft_program (NftError)

| Code | Tên | Khi nào |
|---|---|---|
| 6000 | `NameTooLong` | name > 32 ký tự |
| 6001 | `SymbolTooLong` | symbol > 10 ký tự |
| 6002 | `UriTooLong` | uri > 200 ký tự |
| 6003 | `InvalidRoyalty` | royalty > 10000 (basis points) |
| 6004 | `Unauthorized` | signer ≠ authority |
| 6005 | `NotActive` | config/rally.active == false |
| 6006 | `InvalidCheckpointIndex` | index ngoài range |
| 6007 | `InvalidTotalCheckpoints` | total không hợp lệ (1-254) |
| 6008 | `AlreadyUsed` | RWA đã được dùng |
| 6009 | `TokenNotOwned` | user.token_account.amount < 1 |
| 6010 | `Overflow` | checked_add thất bại |
| 6011 | `MetadataAlreadyExists` | metadata PDA không rỗng |
| 6012 | `StillActive` | chưa deactivate trước khi close |
| 6013 | `ProgramPaused` | minting đang tạm dừng |
| 6014 | `MintNotCreated` | mint không khớp với config |

### sbt_program (SbtError)

| Code | Tên | Khi nào |
|---|---|---|
| 6000-6006 | Validation errors | NameTooLong, SymbolTooLong, UriTooLong, InvalidMissionIndex, InvalidTotalMissions, Unauthorized, NotActive |
| 6007 | `AlreadyRevoked` | SBT đã bị thu hồi |
| 6008 | `SbtRevoked` | SBT không hợp lệ (đã revoke) |
| 6009 | `NotOwner` | signer không phải owner |
| 6010 | `MintMismatch` | mint không khớp |
| 6011 | `ExtensionError` | Token-2022 extension CPI thất bại |
| 6012 | `Overflow` | arithmetic overflow |
| 6013 | `ProgramPaused` | minting đang tạm dừng |
| 6014 | `MintNotCreated` | mint chưa tạo |

---

## 9. Cách Build, Deploy, và Test

### Yêu Cầu

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# Node dependencies
yarn install
```

### Build

```bash
anchor build           # biên dịch cả 2 programs → target/deploy/*.so + target/idl/*.json
```

### Test (Localnet)

```bash
anchor test            # khởi động validator ảo, chạy tests/nft.ts + tests/sbt.ts
```

### Deploy lên Devnet

```bash
solana config set --url devnet
solana airdrop 2                  # nạp SOL để trả phí
anchor build
anchor deploy                     # hoặc: ts-node scripts/deploy.ts
```

### Chạy Mint Scripts

```bash
# Mint HumanCapital SBT
ts-node scripts/mint-sbt.ts [RECIPIENT_PUBKEY]

# Mint RWA SFT (demo flow: initConfig → createRwaMint → mintRwa)
ts-node scripts/mint-nft.ts [RECIPIENT_PUBKEY]
```

> Nếu bỏ qua `RECIPIENT_PUBKEY`, script sẽ mint cho chính wallet đang dùng.

---

## 10. Luồng Tương Tác Toàn Hệ Thống

### Setup (chỉ làm 1 lần)

```
Admin wallet
    │
    ├─ nft_program.initializeConfig(0)  → NftConfig [rwa]
    ├─ nft_program.initializeConfig(1)  → NftConfig [stamp]
    ├─ sbt_program.initializeConfig(0)  → SbtConfig [human_capital]
    ├─ sbt_program.initializeConfig(1)  → SbtConfig [event]
    ├─ sbt_program.initializeConfig(2)  → SbtConfig [challenge_accepted]
    └─ sbt_program.initializeConfig(3)  → SbtConfig [challenge_mission]
```

### Tạo Collection

```
Admin wallet
    │
    ├─ nft_program.createRwaMint(challenge_id, ...)  → RwaConfig + shared SPL mint + Metaplex metadata
    ├─ nft_program.createRally(rally_id, ...)        → RallyConfig
    │      └─ nft_program.createStampMint(idx)  [×N] → CheckpointMint + shared SPL mint
    │
    ├─ sbt_program.createEvent(event_id, ...)        → EventConfig + shared Token-2022 SFT mint
    └─ sbt_program.createChallenge(challenge_id, ...) → ChallengeConfig + 3 shared Token-2022 mints
```

### User Tương Tác

```
User wallet
    │
    ├─ nft_program.mintRwa(challenge_id)             → nhận 1 RWA token (transferable)
    │      └─ nft_program.useRwa(challenge_id)       → đánh dấu đã dùng
    │      └─ nft_program.burnRwa(challenge_id)      → trả lại, thu hồi rent
    │
    ├─ nft_program.mintStamp(checkpoint_index)       → nhận 1 stamp (transferable)
    │      └─ nft_program.burnStamp(checkpoint_index)
    │
    ├─ sbt_program.mintHumanCapital(...)             → nhận SBT cá nhân (frozen)
    ├─ sbt_program.mintEventSbt(event_id)            → nhận event SBT (frozen)
    ├─ sbt_program.mintChallengeAccepted(id)         → SBT chấp nhận challenge
    └─ sbt_program.mintChallengeMission(id, idx)     → SBT từng mission
```

### Admin Thu Hồi SBT

```
Admin wallet
    └─ sbt_program.revokeSbt(sbt_type, mission_index)
           │  PermanentDelegate ký → thaw ATA → burn
           └─ SbtRecord.revoked = true
```

---

## 11. Điểm Quan Trọng Cần Nhớ

### Khi Làm Việc Với nft_program

1. **Shared mint phải tồn tại trước:** Luôn gọi `createRwaMint` / `createStampMint` trước khi `mintRwa` / `mintStamp`.
2. **RwaIssuance là dedup guard:** PDA `[rwa_issuance, challenge_id, user]` đảm bảo mỗi user chỉ mint 1 lần cho 1 challenge.
3. **StampParticipation là dedup guard:** PDA `[stamp_participation, rally_id, checkpoint, user]` đảm bảo 1 stamp per checkpoint per user.
4. **Metaplex metadata:** `createRwaMint` gọi trực tiếp CPI vào `mpl_token_metadata` bằng `invoke()` (không dùng Anchor wrapper).

### Khi Làm Việc Với sbt_program

1. **4 SbtConfig trước tất cả:** Gọi `initializeConfig(0)`, `initializeConfig(1)`, `initializeConfig(2)`, `initializeConfig(3)` trước bất kỳ thao tác nào.
2. **Mint keypair phải là Signer:** `createEvent`, `createChallenge`, `mintHumanCapital` đều yêu cầu mint keypair ký — phải truyền vào `.signers([mintKeypair])`.
3. **batchMintEvent dùng remaining_accounts:** Mỗi recipient truyền vào 2 account: `recipient` (SystemAccount) và `tokenAccount` (ATA).
4. **ATA của SBT dùng Token-2022 program:** `getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID)` — không phải TOKEN_PROGRAM_ID.
5. **HumanCapital collection_id = mint bytes:** `collection_id = Array.from(mintKeypair.publicKey.toBytes())` — không phải event_id hay challenge_id.

### Khi Viết Test

- Các biến như `rwaSftMint`, `checkpointMints`, `eventSftMint` phải khai báo ở scope ngoài cùng của `describe` để chia sẻ giữa các `it` / `describe` lồng nhau.
- Thứ tự test phản ánh thứ tự thực thi: setup → create → mint → use/burn.
- Dùng `before()` để tạo shared mint accounts trước khi test từng mint operation.

---

## 12. Dependencies Chính

```json
{
  "Rust": {
    "anchor-lang": "0.32.1",
    "anchor-spl": "0.32.1 (token, token_2022, associated_token, metadata)",
    "mpl-token-metadata": "4.x (Metaplex cho NFT)",
    "spl-token-metadata-interface": "0.4.x (Token-2022 embedded metadata)"
  },
  "TypeScript": {
    "@coral-xyz/anchor": "0.32.1",
    "@solana/web3.js": "1.95.x",
    "@solana/spl-token": "0.4.x",
    "mocha": "test runner",
    "chai": "assertions"
  }
}
```

**Lưu ý về `anchor` 0.32:** Constructor `new Program(idl, provider)` — program ID phải được set vào `idl.address` trước. Không còn dùng cú pháp `new Program(idl, programId, provider)` nữa.

---

## 13. Lỗi Build Đã Biết & Cách Fix

### Bug: `solana-zk-token-sdk 3.1.11` không compile được

**Triệu chứng:** `anchor build` báo lỗi:
```
error[E0412]: cannot find type `PedersenCommitment` in this scope
  --> src/instruction/transfer/with_fee.rs:62:65
error[E0425]: cannot find value `MAX_FEE_BASIS_POINTS` in this scope
error[E0433]: failed to resolve: use of undeclared type `Pedersen`
```

**Nguyên nhân gốc:**

Đây là bug trong crate `solana-zk-token-sdk 3.1.11` do Anza publish. Hai static variable trong `with_fee.rs` thiếu attribute `#[cfg(not(target_os = "solana"))]`, khiến compiler không tìm thấy các type đã được guard bởi cfg đó khi compile cho SBF target.

Dependency chain dẫn đến crate này:
```
anchor-spl 0.32.1
  → spl-token-metadata-interface 0.3.4
    → spl-pod 0.2.3
      → solana-zk-token-sdk >= 1.18.2   ← không có upper bound
                                          → cargo resolved: 3.1.11 (buggy)
```

Lỗi xuất hiện vì `anchor-spl 0.32.1` được viết cho Agave 2.x, trong khi Agave 3.x publish crate này với bug chưa được fix.

**Cách fix đã áp dụng (trong repo này):**

Vendor crate vào `vendor/solana-zk-token-sdk/` và dùng `[patch.crates-io]` trong workspace `Cargo.toml`. Hai thay đổi cụ thể trong vendor:

1. `src/instruction/transfer/with_fee.rs` — thêm `#[cfg(not(target_os = "solana"))]` trước 2 static bị thiếu
2. `src/sigma_proofs/errors.rs` — thêm `#![allow(dead_code)]` vì các error struct không dùng đến sẽ bị `-D warnings` của Anchor IDL build biến thành error

**Khi nào bỏ workaround:** Khi Anza publish `solana-zk-token-sdk 3.1.12+` với bug đã fix, xóa thư mục `vendor/` và xóa block `[patch.crates-io]` trong `Cargo.toml`.

---

### Lưu Ý Môi Trường Build

**PATH phải có Agave bin mỗi lần mở terminal mới:**
```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```
Thêm dòng này vào `~/.bashrc` để không cần gõ lại.

**Anchor 0.32.1 + Agave 3.x = không chính thức tương thích.** Anchor 0.32.1 được build nhắm vào Agave 2.x. Agave 3.x hoạt động được (sau workaround trên) nhưng nếu gặp thêm lỗi dependency lạ, kiểm tra bằng:
```bash
# Trace dependency chain của bất kỳ crate nào
cargo tree -p <crate-name> --depth 3
```

**`cargo clean` không xóa registry cache** — nếu cần reset hoàn toàn:
```bash
cargo clean                          # xóa target/
rm -rf ~/.cargo/registry/cache/      # xóa registry cache (re-download)
```

**Sau khi clone repo lần đầu**, không cần làm gì thêm — `vendor/` đã được commit, `[patch.crates-io]` tự động được áp dụng khi chạy `anchor build`.
