# Phân tích chức năng dự án NFT-SBT

> Cập nhật: 2026-03-19

---

## 1. Tổng quan

Dự án gồm **2 Anchor program** trên Solana (Token-2022 + SPL Token + Metaplex):

| Program | Purpose |
|---|---|
| `sbt_program` | Soulbound Token — 4 loại SBT không thể chuyển nhượng |
| `nft_program` | NFT thông thường — RWA và Stamp Rally |

---

## 2. Danh sách đầy đủ chức năng hiện có

### 2.1 sbt_program — 11 instruction

| # | Instruction | Mô tả | Ai gọi |
|---|---|---|---|
| 1 | `initialize_config(sbt_type: u8)` | Tạo `SbtConfig` PDA cho 1 loại SBT (type 0–3). Gọi 4 lần để khởi tạo đủ 4 loại. | Authority |
| 2 | `create_event(event_id, name, symbol, uri)` | Tạo `EventConfig` PDA — định nghĩa 1 event với URI cố định. | Authority |
| 3 | `update_event(active: bool)` | Bật/tắt event (chỉ field `active`). | Authority |
| 4 | `create_challenge(challenge_id, name, symbol, uri_accepted, uri_mission, uri_complete, total_missions)` | Tạo `ChallengeConfig` PDA với 3 URI: accepted / mission / complete. | Authority |
| 5 | `update_challenge(active: bool)` | Bật/tắt challenge (chỉ field `active`). | Authority |
| 6 | `mint_human_capital(name, issuer, uri)` | Mint SBT loại HumanCapital (type=0). Dedup theo `(type=0, zeros, 0, user)`. | Authority |
| 7 | `mint_event_sbt(name, issuer)` | Mint SBT loại Event (type=1). URI lấy từ `EventConfig`. Dedup theo `(type=1, event_id, 0, user)`. | Authority |
| 8 | `mint_challenge_accepted(name, issuer)` | Mint SBT ChallengeAccepted (type=2). Dedup theo `(type=2, challenge_id, 0, user)`. | Authority |
| 9 | `mint_challenge_mission(mission_index, name, issuer)` | Mint SBT ChallengeMission (type=3). `mission_index=255` = complete. Dedup theo `(type=3, challenge_id, mission_index, user)`. | Authority |
| 10 | `revoke_sbt(sbt_type)` | Thu hồi SBT: thaw → burn → đánh dấu `revoked=true` trong `SbtRecord`. | Authority |
| 11 | `verify_sbt()` | Kiểm tra SBT hợp lệ (chưa revoked, đúng owner). Read-only, on-chain. | Bất kỳ ai |

**State accounts của sbt_program:**

| Account | Seeds | Nội dung |
|---|---|---|
| `SbtConfig` | `["sbt_config", sbt_type]` | authority, sbt_type, sbt_count, bump |
| `EventConfig` | `["event_config", event_id]` | event_id, name, symbol, uri, authority, participant_count, active, bump |
| `ChallengeConfig` | `["challenge_config", challenge_id]` | challenge_id, name, symbol, uri_accepted, uri_mission, uri_complete, total_missions, authority, participant_count, active, bump |
| `SbtRecord` | `["sbt_record", mint]` | owner, mint, sbt_type, uri, event_id, challenge_id, mission_index, name, issuer, issued_at, revoked, bump |
| `ParticipationRecord` | `["participation", sbt_type, collection_id, mission_index, user]` | Chỉ dùng để dedup — tồn tại = đã mint |

---

### 2.2 nft_program — 6 instruction

| # | Instruction | Mô tả | Ai gọi |
|---|---|---|---|
| 1 | `initialize_config(collection_type: u8)` | Tạo `NftConfig` PDA cho 1 loại collection (type=0 RWA, type=1 StampRally). | Authority |
| 2 | `create_rally(rally_id, name, symbol, uri_stamp, uri_complete, total_checkpoints)` | Tạo `RallyConfig` PDA — định nghĩa 1 Stamp Rally với 2 URI và số checkpoint. | Authority |
| 3 | `update_rally(active: bool)` | Bật/tắt rally (chỉ field `active`). | Authority |
| 4 | `mint_rwa(name, symbol, uri, royalty, challenge_id)` | Mint RWA NFT (SPL Token + Metaplex). Dedup theo `(challenge_id, user)`. | Authority |
| 5 | `mint_stamp(checkpoint_index, name, symbol, royalty)` | Mint Stamp NFT. `checkpoint_index=255` → dùng `uri_complete`. Dedup theo `(rally_id, checkpoint_index, user)`. | Authority |
| 6 | `use_rwa()` | Đánh dấu RWA NFT đã sử dụng (`is_used=true`, lưu `used_at`). Kiểm tra người dùng đang giữ NFT. | Người giữ NFT |

**State accounts của nft_program:**

| Account | Seeds | Nội dung |
|---|---|---|
| `NftConfig` | `["nft_config", collection_type]` | authority, collection_type, nft_count, bump |
| `RallyConfig` | `["rally_config", rally_id]` | rally_id, name, symbol, uri_stamp, uri_complete, total_checkpoints, authority, participant_count, active, bump |
| `RwaIssuance` | `["rwa_issuance", challenge_id, user]` | Dedup RWA — tồn tại = đã mint |
| `RwaRecord` | `["rwa_record", mint]` | mint, owner_at_mint, challenge_id, is_used, used_at, bump |
| `StampParticipation` | `["stamp_participation", rally_id, checkpoint_index, user]` | Dedup Stamp — tồn tại = đã mint |
| `StampRecord` | `["stamp_record", mint]` | mint, rally_id, checkpoint_index, bump |

---

## 3. Chức năng ĐANG THIẾU

### 3.1 Thiếu nghiêm trọng (nên thêm)

#### `transfer_authority` — Chuyển quyền admin
**Cả 2 program đều thiếu instruction này.**

Hiện tại `SbtConfig.authority` và `NftConfig.authority` được ghi một lần khi `initialize_config` và không bao giờ thay đổi được. Nếu:
- Wallet authority bị lộ private key
- Cần chuyển giao dự án cho người khác
- Muốn dùng multisig thay thế

→ **Không có cách nào thay đổi authority**. Phải deploy lại program từ đầu.

```rust
// Ví dụ instruction cần thêm:
// transfer_authority(new_authority: Pubkey) → cập nhật config.authority
```

Tương tự cần cho: `EventConfig.authority`, `ChallengeConfig.authority`, `RallyConfig.authority`.

---

#### `update_event` metadata / `update_challenge` metadata / `update_rally` metadata
Hiện tại `update_event`, `update_challenge`, `update_rally` chỉ cập nhật được flag `active`. **Không thể sửa URI, name, symbol** sau khi tạo.

Trường hợp cần: URI Arweave/IPFS bị thay đổi, sai chính tả tên event, cần cập nhật artwork.

---

#### `burn_nft` — Đốt NFT (nft_program)
**nft_program không có bất kỳ instruction nào để hủy NFT.**

- `sbt_program` có `revoke_sbt` (thaw → burn) để thu hồi SBT
- `nft_program` **không có** instruction tương đương

Người dùng có thể burn trực tiếp qua SPL Token nhưng `RwaRecord` / `StampRecord` PDA sẽ vẫn tồn tại trên chain (lãng phí rent, dữ liệu mồ côi).

---

#### `close_event` / `close_challenge` / `close_rally`
Sau khi event/challenge/rally kết thúc, các PDA config vẫn tồn tại mãi mãi trên chain. Không có instruction để close và lấy lại rent (~0.003–0.007 SOL mỗi account).

---

### 3.2 Thiếu nhỏ (nice-to-have)

#### `update_config_authority` cho EventConfig / ChallengeConfig / RallyConfig
Các collection config (EventConfig, ChallengeConfig, RallyConfig) lưu `authority` riêng, nhưng hiện tại không có instruction nào để cập nhật field này.

#### Batch mint
Không thể mint nhiều token trong 1 transaction. Mỗi lần chỉ mint được 1 token, tốn nhiều transaction fee khi cần mint hàng loạt.

#### `get_sbt_count` / `get_nft_count` off-chain convenience
Không ảnh hưởng on-chain nhưng scripts hiện tại thiếu các helper function để query số lượng token đã mint.

---

## 4. Điểm KHÔNG NHẤT QUÁN (giữa docs và code)

### 4.1 README.md (English) hoàn toàn lỗi thời — NGHIÊM TRỌNG

`README.md` mô tả **kiến trúc cũ** không còn phản ánh code thực:

| README.md nói | Code thực tế |
|---|---|
| `nft_program` có `transfer_nft` | **Không có** `transfer_nft` trong code |
| `sbt_program` chỉ có 4 instructions | **11 instructions** trong code |
| `nft_program` chỉ có 3 instructions | **6 instructions** trong code |
| `SbtConfig` có fields: `authority, sbt_count, bump` | Thực tế còn có `sbt_type` |
| `SbtRecord` có: `owner, mint, issuer, issued_at, revoked, bump` | Thực tế còn có: `sbt_type, uri, event_id, challenge_id, mission_index, name` |
| Token standard: SPL Token cho SBT | Thực tế dùng **Token-2022** với extensions |
| Không đề cập RWA, Stamp Rally, Event, Challenge | Đây là chức năng chính của cả 2 program |

→ **README.md cần được viết lại hoàn toàn** hoặc thay thế bằng INSTRUCT.md.

### 4.2 Scripts có thể lỗi thời

`scripts/mint-nft.ts` và `scripts/mint-sbt.ts` được viết cho architecture cũ (simple mint_nft / mint_sbt). Chưa rõ các script này có phù hợp với architecture mới (RWA/Stamp/Event/Challenge) hay không.

### 4.3 SbtRecord lãng phí space cho HumanCapital

`SbtRecord` luôn allocate 64 bytes cho `event_id` và `challenge_id` (2 × 32 bytes), kể cả khi SBT là HumanCapital (type=0) — những field này sẽ là zeros. Tổng lãng phí: ~64 bytes × số lượng HumanCapital SBT đã mint.

---

## 5. Chức năng CÓ THỂ THỪA

### 5.1 `verify_sbt` as on-chain instruction
`verify_sbt` là read-only — không thay đổi state. Việc gọi nó như 1 on-chain transaction tốn phí không cần thiết (0.000005 SOL/lần). Verification thông thường nên làm **off-chain** bằng cách fetch `SbtRecord` account trực tiếp.

On-chain verification chỉ hữu ích nếu có program khác cần gọi CPI vào `verify_sbt` để compose. Nếu không có use case đó, đây là overhead.

### 5.2 README.md (English) vs INSTRUCT.md (Vietnamese)
Có 2 file documentation mô tả cùng 1 project nhưng nội dung không khớp. Nên chọn 1 file làm "source of truth" và xóa/archive file còn lại.

---

## 6. Tóm tắt

### Cần thêm (ưu tiên cao)
| # | Feature | Program | Lý do |
|---|---|---|---|
| 1 | `transfer_authority(new_authority)` | Cả 2 | Không thể thay đổi admin nếu wallet bị lộ |
| 2 | `update_event/challenge/rally` metadata | Cả 2 | Không sửa được URI/name sau khi tạo |
| 3 | `burn_nft` (+ close RwaRecord/StampRecord) | nft_program | Không có cách hủy NFT sạch |
| 4 | `close_event/challenge/rally` | Cả 2 | Lấy lại rent sau khi kết thúc |

### Cần sửa (documentation)
| # | Vấn đề | Mức độ |
|---|---|---|
| 1 | README.md (English) mô tả sai hoàn toàn so với code | Nghiêm trọng |
| 2 | Scripts `mint-nft.ts`, `mint-sbt.ts` cần kiểm tra lại | Trung bình |

### Có thể cân nhắc
| # | Feature | Ghi chú |
|---|---|---|
| 1 | `verify_sbt` off-chain thay vì on-chain instruction | Tiết kiệm fee |
| 2 | Tối ưu `SbtRecord` space cho HumanCapital | Minor gas optimization |
