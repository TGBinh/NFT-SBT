# NFT-SBT Project — Hướng dẫn

## Tổng quan

Dự án gồm **2 Anchor program** chạy trên Solana:

| Program | Program ID | Chức năng |
|---|---|---|
| `sbt_program` | `51G8WL8HZnib5SyV929K2DyqGEMRn89Bx6nJMitsP2QH` | Phát hành SBT (Soul Bound Token) — token không thể chuyển nhượng |
| `nft_program` | `Hd9Bnkfs4ib9wV71fi8ica9skTZQ1ZciWe4RrhYP5mVY` | Phát hành NFT (RWA và Stamp Rally) — token thông thường có metadata |

---

## Yêu cầu môi trường

```
Rust       >= 1.75
Solana CLI >= 1.18
Anchor CLI >= 0.32.1
Node.js    >= 18
Yarn       >= 4
```

Cài đặt Anchor:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1
avm use 0.32.1
```

---

## Setup lần đầu

```bash
# 1. Clone và vào thư mục
git clone <repo-url>
cd NFT-SBT

# 2. Cài dependencies TypeScript
yarn install

# 3. Tạo keypair Solana (nếu chưa có)
solana-keygen new --outfile ~/.config/solana/id.json

# 4. Build cả 2 program
anchor build
```

---

## Chạy test

Test dùng local validator (tự động khởi động bởi `anchor test`):

```bash
anchor test
```

Lệnh này sẽ:
1. Khởi động `solana-test-validator` local
2. Deploy cả 2 program lên validator
3. Chạy `tests/sbt.ts` và `tests/nft.ts`
4. In kết quả pass/fail

Chạy riêng từng file test (sau khi đã có validator chạy):
```bash
anchor test --skip-local-validator -- --grep "sbt_program"
anchor test --skip-local-validator -- --grep "nft_program"
```

---

## Deploy lên Devnet

```bash
# 1. Lấy SOL devnet (cần ít nhất 4 SOL để deploy 2 program)
solana airdrop 2 --url devnet
solana airdrop 2 --url devnet

# 2. Deploy
yarn deploy
# hoặc: ts-node scripts/deploy.ts

# 3. Sau khi deploy, script sẽ in ra Program ID mới.
#    Nếu ID thay đổi, cập nhật 2 nơi:
#    - Anchor.toml: [programs.devnet]
#    - programs/*/src/lib.rs: declare_id!(...)
#    Rồi rebuild: anchor build
```

---

## Cấu trúc file và ý nghĩa

```
NFT-SBT/
├── Anchor.toml                    # Cấu hình Anchor: cluster, wallet, program IDs, test script
├── Cargo.toml                     # Workspace Rust, khai báo 2 member program
├── package.json                   # Scripts yarn: test, build, deploy, mint
├── tsconfig.json                  # Cấu hình TypeScript cho tests và scripts
│
├── programs/
│   ├── sbt_program/               # Program 1: SBT
│   │   ├── Cargo.toml             # Dependencies: anchor-lang, anchor-spl (token-2022)
│   │   └── src/
│   │       ├── lib.rs             # Entry point: khai báo program ID, wire tất cả instruction
│   │       ├── errors.rs          # Custom error codes (SbtError enum)
│   │       ├── token_utils.rs     # Helper: tạo mint Token-2022 với NonTransferable + PermanentDelegate + Freeze
│   │       ├── state/
│   │       │   ├── mod.rs         # Re-export tất cả state structs
│   │       │   ├── sbt_config.rs  # PDA per-type config (authority, sbt_type, sbt_count)
│   │       │   ├── event_config.rs        # PDA config cho Event SBT (name, uri, active, participant_count)
│   │       │   ├── challenge_config.rs    # PDA config cho Challenge (3 URI, total_missions, active)
│   │       │   ├── sbt_record.rs          # PDA lưu thông tin từng SBT đã mint (owner, mint, revoked...)
│   │       │   └── participation_record.rs # PDA dedup: mỗi (type, collection, mission, user) chỉ mint 1 lần
│   │       └── instructions/
│   │           ├── mod.rs                 # Re-export tất cả instructions
│   │           ├── initialize_config.rs   # Tạo SbtConfig PDA cho 1 type
│   │           ├── create_event.rs        # Tạo EventConfig PDA
│   │           ├── update_event.rs        # Bật/tắt event (active flag)
│   │           ├── create_challenge.rs    # Tạo ChallengeConfig PDA
│   │           ├── update_challenge.rs    # Bật/tắt challenge
│   │           ├── mint_human_capital.rs  # Mint SBT type HumanCapital (type=0)
│   │           ├── mint_event_sbt.rs      # Mint SBT type Event (type=1)
│   │           ├── mint_challenge_accepted.rs  # Mint SBT ChallengeAccepted (type=2)
│   │           ├── mint_challenge_mission.rs   # Mint SBT ChallengeMission (type=3), hỗ trợ sentinel 255=complete
│   │           ├── revoke_sbt.rs          # Thu hồi SBT: thaw → burn → mark revoked
│   │           └── verify_sbt.rs          # Kiểm tra SBT hợp lệ (chưa revoke, đúng owner)
│   │
│   └── nft_program/               # Program 2: NFT
│       ├── Cargo.toml             # Dependencies: anchor-lang, anchor-spl, mpl-token-metadata 5.1.1
│       └── src/
│           ├── lib.rs             # Entry point: khai báo program ID, wire tất cả instruction
│           ├── errors.rs          # Custom error codes (NftError enum)
│           ├── state/
│           │   ├── mod.rs
│           │   ├── nft_config.rs          # PDA per-type config (authority, collection_type, nft_count)
│           │   ├── rally_config.rs        # PDA config Stamp Rally (uri_stamp, uri_complete, total_checkpoints)
│           │   ├── rwa_issuance.rs        # PDA dedup RWA: mỗi (challenge_id, user) chỉ mint 1 lần
│           │   ├── rwa_record.rs          # PDA lưu thông tin RWA NFT (mint, owner_at_mint, is_used)
│           │   ├── stamp_participation.rs # PDA dedup Stamp: mỗi (rally, checkpoint, user) chỉ mint 1 lần
│           │   └── stamp_record.rs        # PDA lưu thông tin từng Stamp NFT
│           └── instructions/
│               ├── mod.rs
│               ├── initialize_config.rs   # Tạo NftConfig PDA cho 1 collection type
│               ├── create_rally.rs        # Tạo RallyConfig PDA
│               ├── update_rally.rs        # Bật/tắt rally
│               ├── mint_rwa.rs            # Mint RWA NFT (SPL Token + Metaplex metadata)
│               ├── mint_stamp.rs          # Mint Stamp NFT, checkpoint_index=255 → uri_complete
│               └── use_rwa.rs             # Đánh dấu RWA đã dùng (is_used=true), NFT vẫn trong ví
│
├── tests/
│   ├── sbt.ts                     # Test suite cho sbt_program
│   └── nft.ts                     # Test suite cho nft_program
│
└── scripts/
    ├── deploy.ts                  # Build + deploy cả 2 program lên devnet
    ├── mint-nft.ts                # Script thử mint NFT sau khi deploy
    └── mint-sbt.ts                # Script thử mint SBT sau khi deploy
```

---

## Cách các file tương tác với nhau

### sbt_program — luồng phụ thuộc

```
lib.rs
  └── wire instructions → instructions/mod.rs (re-export tất cả)
        ├── initialize_config.rs
        │     └── dùng state: SbtConfig
        ├── create_event.rs
        │     └── dùng state: SbtConfig (xác nhận authority), EventConfig (tạo mới)
        ├── update_event.rs
        │     └── dùng state: EventConfig
        ├── create_challenge.rs
        │     └── dùng state: SbtConfig, ChallengeConfig
        ├── update_challenge.rs
        │     └── dùng state: ChallengeConfig
        ├── mint_human_capital.rs
        │     ├── dùng state: SbtConfig (type=0), SbtRecord (tạo), ParticipationRecord (dedup)
        │     └── gọi helper: token_utils::mint_sbt_token()
        ├── mint_event_sbt.rs
        │     ├── dùng state: SbtConfig (type=1), EventConfig (đọc uri + active), SbtRecord, ParticipationRecord
        │     └── gọi helper: token_utils::mint_sbt_token()
        ├── mint_challenge_accepted.rs
        │     ├── dùng state: SbtConfig (type=2), ChallengeConfig, SbtRecord, ParticipationRecord
        │     └── gọi helper: token_utils::mint_sbt_token()
        ├── mint_challenge_mission.rs
        │     ├── dùng state: SbtConfig (type=3), ChallengeConfig, SbtRecord, ParticipationRecord
        │     └── gọi helper: token_utils::mint_sbt_token()
        ├── revoke_sbt.rs
        │     └── dùng state: SbtConfig (PDA signer để thaw/burn), SbtRecord (đánh dấu revoked)
        └── verify_sbt.rs
              └── dùng state: SbtRecord (đọc revoked, owner, mint)

token_utils.rs — không phụ thuộc state, chỉ dùng Token-2022 CPI
```

### nft_program — luồng phụ thuộc

```
lib.rs
  └── wire instructions → instructions/mod.rs
        ├── initialize_config.rs
        │     └── dùng state: NftConfig
        ├── create_rally.rs
        │     └── dùng state: NftConfig (type=1), RallyConfig (tạo mới)
        ├── update_rally.rs
        │     └── dùng state: RallyConfig
        ├── mint_rwa.rs
        │     ├── dùng state: NftConfig (type=0), RwaIssuance (dedup, tạo), RwaRecord (tạo)
        │     └── CPI: SPL Token (mint) + Metaplex (metadata + master edition)
        ├── mint_stamp.rs
        │     ├── dùng state: NftConfig (type=1), RallyConfig (đọc uri + active + total_checkpoints)
        │     │              StampParticipation (dedup, tạo), StampRecord (tạo)
        │     └── CPI: SPL Token (mint) + Metaplex (metadata + master edition)
        └── use_rwa.rs
              └── dùng state: RwaRecord (cập nhật is_used + used_at)
                  đọc: TokenAccount (kiểm tra balance >= 1)
```

### Thứ tự gọi instruction đúng

**sbt_program:**
```
initialize_config(type=0,1,2,3)  ← phải chạy đầu tiên cho từng type
  ↓
create_event / create_challenge  ← tạo collection config
  ↓
mint_*_sbt                       ← mint cho user
  ↓
verify_sbt                       ← verify bất kỳ lúc nào
revoke_sbt                       ← thu hồi khi cần
```

**nft_program:**
```
initialize_config(type=0)        ← cho RWA collection
initialize_config(type=1)        ← cho StampRally collection
  ↓
create_rally                     ← tạo rally config (chỉ cần cho Stamp)
  ↓
mint_rwa                         ← mint RWA NFT cho user
mint_stamp                       ← mint Stamp NFT cho user
  ↓
use_rwa                          ← đánh dấu RWA đã dùng
```

---

## Cơ chế dedup (chống double-mint)

Cả 2 program dùng Anchor `init` constraint để ngăn double-mint **tự động và atomic**:

- **ParticipationRecord** (sbt): seeds = `[b"participation", sbt_type, collection_id, mission_index, user]`
- **RwaIssuance** (nft): seeds = `[b"rwa_issuance", challenge_id, user]`
- **StampParticipation** (nft): seeds = `[b"stamp_participation", rally_id, checkpoint_index, user]`

Nếu user thử mint lần 2 → Anchor sẽ thử `init` PDA đã tồn tại → transaction lỗi ngay lập tức.

---

## Đặc điểm Token

| | SBT | RWA NFT | Stamp NFT |
|---|---|---|---|
| Token standard | Token-2022 | SPL Token | SPL Token |
| Chuyển nhượng | Không (NonTransferable) | Có | Có |
| Thu hồi | Có (PermanentDelegate + Freeze) | Không | Không |
| Metadata | Trong SbtRecord PDA | Metaplex on-chain | Metaplex on-chain |
| Supply | 1 per mint | 1 per mint | 1 per mint |
