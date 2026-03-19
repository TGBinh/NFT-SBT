# Changelog — Missing Features Implementation
> Ngày: 2026-03-19

---

## Tổng quan

Bổ sung 7 chức năng còn thiếu từ `ANALYSIS.md §3.1` vào cả 2 programs. Mỗi mục ghi rõ file nào thay đổi, thay đổi gì, và cách revert nếu cần.

---

## 1. `transfer_authority` — sbt_program

### Files tạo mới
- **`programs/sbt_program/src/instructions/transfer_authority.rs`** *(file mới hoàn toàn)*
  - Instruction cho phép authority hiện tại chuyển quyền sang wallet mới
  - Kiểm tra `require_keys_eq!(config.authority, authority.key())`

### Files sửa
- **`programs/sbt_program/src/instructions/mod.rs`**
  - Thêm 2 dòng ở cuối:
    ```rust
    pub mod transfer_authority;
    pub use transfer_authority::*;
    ```
- **`programs/sbt_program/src/lib.rs`**
  - Thêm instruction entry point vào `pub mod sbt_program`:
    ```rust
    pub fn transfer_authority(ctx: Context<TransferAuthority>, sbt_type: u8, new_authority: Pubkey) -> Result<()>
    ```
- **`tests/sbt.ts`**
  - Append describe block `"transfer_authority (sbt)"` với 2 test ở cuối file (trước `});`)

### Cách revert
1. Xóa file `programs/sbt_program/src/instructions/transfer_authority.rs`
2. Xóa 2 dòng vừa thêm trong `mod.rs`
3. Xóa function `transfer_authority` trong `lib.rs`
4. Xóa describe block `"transfer_authority (sbt)"` ở cuối `tests/sbt.ts`

---

## 2. `transfer_authority` — nft_program

### Files tạo mới
- **`programs/nft_program/src/instructions/transfer_authority.rs`** *(file mới hoàn toàn)*
  - Logic giống sbt_program nhưng dùng `NFT_CONFIG_SEED` và `NftConfig`

### Files sửa
- **`programs/nft_program/src/instructions/mod.rs`**
  - Thêm vào cuối:
    ```rust
    pub mod transfer_authority;
    pub use transfer_authority::*;
    ```
- **`programs/nft_program/src/lib.rs`**
  - Thêm vào `pub mod nft_program`:
    ```rust
    pub fn transfer_authority(ctx: Context<TransferAuthority>, collection_type: u8, new_authority: Pubkey) -> Result<()>
    ```
- **`tests/nft.ts`**
  - Append describe block `"transfer_authority (nft)"` với 2 test ở cuối file

### Cách revert
1. Xóa file `programs/nft_program/src/instructions/transfer_authority.rs`
2. Xóa 2 dòng vừa thêm trong `mod.rs`
3. Xóa function `transfer_authority` trong `lib.rs`
4. Xóa describe block `"transfer_authority (nft)"` ở cuối `tests/nft.ts`

---

## 3. `update_event` metadata — sbt_program

### Files sửa (không tạo mới)
- **`programs/sbt_program/src/instructions/update_event.rs`** *(rewrite toàn bộ)*
  - **Trước:** `handler(ctx, active: bool)`
  - **Sau:** `handler(ctx, active: bool, name: Option<String>, symbol: Option<String>, uri: Option<String>)`
  - Truyền `null` → giữ nguyên giá trị cũ; truyền giá trị → cập nhật

- **`programs/sbt_program/src/lib.rs`**
  - **Trước:**
    ```rust
    pub fn update_event(ctx: Context<UpdateEvent>, active: bool) -> Result<()>
    ```
  - **Sau:**
    ```rust
    pub fn update_event(ctx: Context<UpdateEvent>, active: bool, name: Option<String>, symbol: Option<String>, uri: Option<String>) -> Result<()>
    ```

- **`tests/sbt.ts`**
  - **Fix tất cả call cũ** (4 chỗ):
    - `.updateEvent(false)` → `.updateEvent(false, null, null, null)`
    - `.updateEvent(true)` → `.updateEvent(true, null, null, null)`
  - Append describe block `"update_event metadata"` với 2 test ở cuối file

### Cách revert
1. Revert `update_event.rs` về: `handler(ctx, active: bool)`
2. Revert signature trong `lib.rs`
3. Trong `tests/sbt.ts`: đổi lại tất cả `updateEvent(false, null, null, null)` → `updateEvent(false)` và `updateEvent(true, null, null, null)` → `updateEvent(true)`
4. Xóa describe block `"update_event metadata"` ở cuối

---

## 4. `update_challenge` metadata — sbt_program

### Files sửa (không tạo mới)
- **`programs/sbt_program/src/instructions/update_challenge.rs`** *(rewrite toàn bộ)*
  - **Trước:** `handler(ctx, active: bool)`
  - **Sau:** `handler(ctx, active: bool, name: Option<String>, symbol: Option<String>, uri_accepted: Option<String>, uri_mission: Option<String>, uri_complete: Option<String>)`

- **`programs/sbt_program/src/lib.rs`**
  - Cập nhật signature tương tự

- **`tests/sbt.ts`**
  - **Fix tất cả call cũ** (2 chỗ):
    - `.updateChallenge(false)` → `.updateChallenge(false, null, null, null, null, null)`
    - `.updateChallenge(true)` → `.updateChallenge(true, null, null, null, null, null)`
  - Append describe block `"update_challenge metadata"` với 2 test ở cuối file

### Cách revert
1. Revert `update_challenge.rs` về: `handler(ctx, active: bool)`
2. Revert signature trong `lib.rs`
3. Trong `tests/sbt.ts`: đổi lại tất cả `updateChallenge(false, null, null, null, null, null)` → `updateChallenge(false)` và tương tự cho `true`
4. Xóa describe block `"update_challenge metadata"` ở cuối

---

## 5. `update_rally` metadata — nft_program

### Files sửa (không tạo mới)
- **`programs/nft_program/src/instructions/update_rally.rs`** *(rewrite toàn bộ)*
  - **Trước:** `handler(ctx, active: bool)`
  - **Sau:** `handler(ctx, active: bool, name: Option<String>, symbol: Option<String>, uri_stamp: Option<String>, uri_complete: Option<String>)`

- **`programs/nft_program/src/lib.rs`**
  - Cập nhật signature tương tự

- **`tests/nft.ts`**
  - **Fix tất cả call cũ** (2 chỗ):
    - `.updateRally(false)` → `.updateRally(false, null, null, null, null)`
    - `.updateRally(true)` → `.updateRally(true, null, null, null, null)`
  - Append describe block `"update_rally metadata"` với 2 test ở cuối file

### Cách revert
1. Revert `update_rally.rs` về: `handler(ctx, active: bool)`
2. Revert signature trong `lib.rs`
3. Trong `tests/nft.ts`: đổi lại tất cả `updateRally(false, null, null, null, null)` → `updateRally(false)` và tương tự cho `true`
4. Xóa describe block `"update_rally metadata"` ở cuối

---

## 6. `burn_rwa` + `burn_stamp` — nft_program

### Files tạo mới
- **`programs/nft_program/src/instructions/burn_rwa.rs`** *(file mới hoàn toàn)*
  - Người giữ NFT gọi để burn token + đóng `RwaRecord` PDA
  - Luồng: kiểm tra `amount >= 1` → `token::burn()` → `token::close_account()` (ATA) → Anchor `close` constraint đóng RwaRecord
  - Chỉ người đang giữ token mới ký được (constraint `associated_token::authority = user`)

- **`programs/nft_program/src/instructions/burn_stamp.rs`** *(file mới hoàn toàn)*
  - Giống `burn_rwa` nhưng đóng `StampRecord` PDA

### Files sửa
- **`programs/nft_program/src/instructions/mod.rs`**
  - Thêm vào cuối:
    ```rust
    pub mod burn_rwa;
    pub mod burn_stamp;
    pub use burn_rwa::*;
    pub use burn_stamp::*;
    ```
- **`programs/nft_program/src/lib.rs`**
  - Thêm vào `pub mod nft_program`:
    ```rust
    pub fn burn_rwa(ctx: Context<BurnRwa>) -> Result<()>
    pub fn burn_stamp(ctx: Context<BurnStamp>) -> Result<()>
    ```
- **`tests/nft.ts`**
  - Append describe blocks `"burn_rwa"` và `"burn_stamp"` ở cuối file

### Cách revert
1. Xóa `burn_rwa.rs` và `burn_stamp.rs`
2. Xóa 4 dòng vừa thêm trong `mod.rs`
3. Xóa 2 function trong `lib.rs`
4. Xóa describe blocks `"burn_rwa"` và `"burn_stamp"` ở cuối `tests/nft.ts`

---

## 7. `close_event` + `close_challenge` — sbt_program

### Files tạo mới
- **`programs/sbt_program/src/instructions/close_event.rs`** *(file mới hoàn toàn)*
  - Đóng `EventConfig` PDA, trả rent về authority
  - Yêu cầu: `event_config.active == false` (phải deactivate trước)
  - Dùng Anchor `close = authority` constraint

- **`programs/sbt_program/src/instructions/close_challenge.rs`** *(file mới hoàn toàn)*
  - Tương tự, đóng `ChallengeConfig` PDA

### Files sửa
- **`programs/sbt_program/src/errors.rs`**
  - Thêm error mới vào cuối enum:
    ```rust
    StillActive, // "Event or challenge is still active — deactivate it first"
    ```
- **`programs/sbt_program/src/instructions/mod.rs`**
  - Thêm vào cuối:
    ```rust
    pub mod close_event;
    pub mod close_challenge;
    pub use close_event::*;
    pub use close_challenge::*;
    ```
- **`programs/sbt_program/src/lib.rs`**
  - Thêm vào `pub mod sbt_program`:
    ```rust
    pub fn close_event(ctx: Context<CloseEvent>) -> Result<()>
    pub fn close_challenge(ctx: Context<CloseChallenge>) -> Result<()>
    ```
- **`tests/sbt.ts`**
  - Append describe blocks `"close_event"` và `"close_challenge"` ở cuối file

### Cách revert
1. Xóa `close_event.rs` và `close_challenge.rs`
2. Xóa `StillActive` khỏi `errors.rs`
3. Xóa 4 dòng vừa thêm trong `mod.rs`
4. Xóa 2 function trong `lib.rs`
5. Xóa describe blocks `"close_event"` và `"close_challenge"` ở cuối `tests/sbt.ts`

---

## 8. `close_rally` — nft_program

### Files tạo mới
- **`programs/nft_program/src/instructions/close_rally.rs`** *(file mới hoàn toàn)*
  - Đóng `RallyConfig` PDA, trả rent về authority
  - Yêu cầu: `rally_config.active == false`

### Files sửa
- **`programs/nft_program/src/errors.rs`**
  - Thêm error mới vào cuối enum:
    ```rust
    StillActive, // "Rally is still active — deactivate it first"
    ```
- **`programs/nft_program/src/instructions/mod.rs`**
  - Thêm vào cuối:
    ```rust
    pub mod close_rally;
    pub use close_rally::*;
    ```
- **`programs/nft_program/src/lib.rs`**
  - Thêm vào `pub mod nft_program`:
    ```rust
    pub fn close_rally(ctx: Context<CloseRally>) -> Result<()>
    ```
- **`tests/nft.ts`**
  - Append describe block `"close_rally"` với 2 test ở cuối file

### Cách revert
1. Xóa `close_rally.rs`
2. Xóa `StillActive` khỏi `errors.rs`
3. Xóa 2 dòng vừa thêm trong `mod.rs`
4. Xóa function trong `lib.rs`
5. Xóa describe block `"close_rally"` ở cuối `tests/nft.ts`

---

## Danh sách tất cả files đã chạm vào

### Files TẠO MỚI (10 files):
```
programs/sbt_program/src/instructions/transfer_authority.rs
programs/sbt_program/src/instructions/close_event.rs
programs/sbt_program/src/instructions/close_challenge.rs
programs/nft_program/src/instructions/transfer_authority.rs
programs/nft_program/src/instructions/burn_rwa.rs
programs/nft_program/src/instructions/burn_stamp.rs
programs/nft_program/src/instructions/close_rally.rs
```

### Files SỬA (9 files):
```
programs/sbt_program/src/instructions/update_event.rs      ← rewrite handler signature
programs/sbt_program/src/instructions/update_challenge.rs  ← rewrite handler signature
programs/sbt_program/src/instructions/mod.rs               ← thêm 6 dòng ở cuối
programs/sbt_program/src/lib.rs                            ← update 2 signature + thêm 3 function
programs/sbt_program/src/errors.rs                         ← thêm StillActive
programs/nft_program/src/instructions/update_rally.rs      ← rewrite handler signature
programs/nft_program/src/instructions/mod.rs               ← thêm 8 dòng ở cuối
programs/nft_program/src/lib.rs                            ← update 1 signature + thêm 4 function
programs/nft_program/src/errors.rs                         ← thêm StillActive
tests/sbt.ts                                               ← fix 6 call cũ + append 5 describe blocks
tests/nft.ts                                               ← fix 4 call cũ + append 5 describe blocks
```

---

## Revert toàn bộ nhanh nhất

Nếu muốn undo tất cả cùng lúc:

```bash
git diff --stat   # xem tất cả file đã thay đổi
git checkout -- programs/  tests/   # revert toàn bộ programs/ và tests/
git rm programs/sbt_program/src/instructions/transfer_authority.rs
git rm programs/sbt_program/src/instructions/close_event.rs
git rm programs/sbt_program/src/instructions/close_challenge.rs
git rm programs/nft_program/src/instructions/transfer_authority.rs
git rm programs/nft_program/src/instructions/burn_rwa.rs
git rm programs/nft_program/src/instructions/burn_stamp.rs
git rm programs/nft_program/src/instructions/close_rally.rs
```

> Lưu ý: Lệnh trên chỉ hoạt động nếu chưa commit. Nếu đã commit, dùng `git revert <commit-hash>`.
