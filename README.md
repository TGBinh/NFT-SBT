# Solana Token Project — NFT & SBT Programs

Two production-grade Anchor programs on Solana Devnet:

| Program | Description |
|---|---|
| `nft_program` | Standard NFT: mint, transfer, Metaplex metadata |
| `sbt_program` | Soulbound Token: mint-only, non-transferable via account freeze |

---

## Architecture

```
solana-token-project/
├─ Anchor.toml                 # Workspace config (cluster, wallet, programs)
├─ Cargo.toml                  # Rust workspace
├─ package.json                # Node dependencies
├─ tsconfig.json
├─ programs/
│  ├─ nft_program/src/lib.rs   # NFT: initialize_config | mint_nft | transfer_nft
│  └─ sbt_program/src/lib.rs   # SBT: initialize_config | mint_sbt | revoke_sbt | verify_sbt
├─ tests/
│  ├─ nft.ts                   # Anchor mocha tests for NFT
│  └─ sbt.ts                   # Anchor mocha tests for SBT (transfer MUST fail)
├─ scripts/
│  ├─ deploy.ts                # Build + deploy both programs to devnet
│  ├─ mint-nft.ts              # Mint a new NFT and print mint address
│  └─ mint-sbt.ts              # Mint SBT to a wallet and verify freeze
└─ README.md
```

### How Soulbound is Enforced

```
 Authority mints SBT
        │
        ▼
 SPL: mint_to(recipient_ata, 1)
        │
        ▼
 SPL: set_authority(mint, MintTokens → None)   ← supply locked at 1
        │
        ▼
 SPL: freeze_account(recipient_ata)            ← account frozen
        │
        ▼
 SPL: set_authority(mint, FreezeAccount → config_PDA)  ← only our PDA can unfreeze
        │
        ▼
 Any transfer attempt → SPL rejects with "account is frozen" (0x11)
```

No `transfer` instruction exists in `sbt_program`. Even if someone calls SPL Token's
transfer directly, the frozen account prevents it at the runtime level.

---

## 1. Environment Setup

### Prerequisites

| Tool | Version |
|---|---|
| Rust | stable (≥ 1.79) |
| Solana CLI | stable (≥ 1.18) |
| Anchor | 0.30.1 |
| Node.js | ≥ 18 |
| Yarn | ≥ 1.22 |

### Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup component add rustfmt clippy
```

### Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
# Add to PATH (follow the installer instructions or run:)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify
solana --version
```

### Install Anchor (via AVM)

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1

# Verify
anchor --version
```

### Install Node.js & Yarn

```bash
# Node.js — use nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20

# Yarn
npm install -g yarn
```

---

## 2. Wallet Setup

```bash
# Generate a new keypair (skip if you already have one)
solana-keygen new --outfile ~/.config/solana/id.json

# Set devnet as default cluster
solana config set --url devnet

# Check your address
solana address

# Airdrop devnet SOL (free)
solana airdrop 2
solana airdrop 2   # Run twice — you need ~4 SOL for deployment + minting

# Check balance
solana balance
```

---

## 3. Install Node Dependencies

```bash
yarn install
```

---

## 4. Build Programs

```bash
anchor build
```

After a successful build you will find:
- `target/deploy/nft_program-keypair.json` — NFT Program keypair
- `target/deploy/sbt_program-keypair.json` — SBT Program keypair
- `target/idl/nft_program.json` — NFT IDL
- `target/idl/sbt_program.json` — SBT IDL

### Update Program IDs (one-time step after first build)

```bash
# Print the program IDs generated from the keypairs
solana address -k target/deploy/nft_program-keypair.json
solana address -k target/deploy/sbt_program-keypair.json
```

Copy the output and:

1. Update `Anchor.toml`:
   ```toml
   [programs.devnet]
   nft_program = "<YOUR_NFT_PROGRAM_ID>"
   sbt_program = "<YOUR_SBT_PROGRAM_ID>"
   ```

2. Update `programs/nft_program/src/lib.rs`:
   ```rust
   declare_id!("<YOUR_NFT_PROGRAM_ID>");
   ```

3. Update `programs/sbt_program/src/lib.rs`:
   ```rust
   declare_id!("<YOUR_SBT_PROGRAM_ID>");
   ```

4. Rebuild:
   ```bash
   anchor build
   ```

---

## 5. Deploy to Devnet

### Option A — Using the deploy script (recommended)

```bash
yarn deploy
# or
ts-node scripts/deploy.ts
```

The script will:
- Switch Solana CLI to devnet
- Run `anchor build`
- Run `anchor deploy`
- Print both program IDs and Solana Explorer links

### Option B — Manual

```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

---

## 6. Run Tests

Tests run against a local validator by default. For devnet, use `--skip-local-validator`.

```bash
# Local validator (recommended for development — fast & free)
anchor test

# Devnet (uses real SOL)
anchor test --skip-local-validator --provider.cluster devnet
```

Expected output:

```
nft_program
  ✓ Initialize config PDA
  ✓ Mint NFT successfully
  ✓ Transfer NFT to recipient
  ✓ Verify metadata PDA exists on-chain
  ✓ Mint NFT with max royalty (100%) succeeds
  ✓ Fail: Mint NFT with invalid royalty > 10000
  ✓ Fail: Non-authority cannot mint NFT

sbt_program
  ✓ Initialize SBT config PDA
  ✓ Mint SBT to recipient successfully
  ✓ CRITICAL: Attempt to transfer SBT — MUST FAIL
  ✓ Verify SBT ownership via program instruction
  ✓ Fail: verifySbt with wrong owner
  ✓ Revoke SBT — authority can burn the token
  ✓ Fail: Non-authority cannot mint SBT
```

---

## 7. Mint Scripts

### Mint a new NFT

```bash
yarn mint:nft
# or
ts-node scripts/mint-nft.ts
```

Output:
```
NFT Mint Address : <MINT_PUBKEY>
Metadata PDA     : <METADATA_PDA>
Master Edition   : <EDITION_PDA>
Transaction      : <TX_HASH>
Explorer         : https://explorer.solana.com/tx/<TX>?cluster=devnet
```

### Mint an SBT

```bash
# Mint to yourself
yarn mint:sbt

# Mint to a specific wallet
yarn mint:sbt <RECIPIENT_PUBKEY>
# or
ts-node scripts/mint-sbt.ts <RECIPIENT_PUBKEY>
```

Output includes Soulbound verification:
```
✅ SOULBOUND VERIFIED: Token account is frozen.
✅ SUPPLY LOCKED: Mint authority removed. Supply is permanently 1.
```

---

## 8. Program Instructions

### nft_program

| Instruction | Accounts | Description |
|---|---|---|
| `initialize_config` | authority, config PDA | One-time setup. Sets authority. |
| `mint_nft(name, symbol, uri, royalty)` | config, authority, mint, token_account, metadata, master_edition | Mints 1 NFT with Metaplex metadata. |
| `transfer_nft` | owner, recipient, mint, from_ata, to_ata | Transfers NFT between wallets. |

### sbt_program

| Instruction | Accounts | Description |
|---|---|---|
| `initialize_config` | authority, config PDA | One-time setup. Sets authority. |
| `mint_sbt(name, symbol, uri, issuer)` | config, authority, recipient, mint, token_account, sbt_record, metadata, master_edition | Mints SBT, freezes account, locks supply. |
| `revoke_sbt` | config, authority, mint, token_account, sbt_record | Burns SBT. Only authority can revoke. |
| `verify_sbt` | owner, mint, token_account, sbt_record | Read-only check of SBT ownership. |

---

## 9. On-Chain State

### NftConfig (PDA: seeds=["nft_config"])
```
authority : Pubkey   — who can mint NFTs
nft_count : u64      — total NFTs minted
bump      : u8
```

### SbtConfig (PDA: seeds=["sbt_config"])
```
authority : Pubkey   — who can mint/revoke SBTs
sbt_count : u64      — total SBTs minted
bump      : u8
```

### SbtRecord (PDA: seeds=["sbt_record", mint_pubkey])
```
owner     : Pubkey   — recipient wallet
mint      : Pubkey   — SPL mint address
issuer    : String   — issuing entity (max 64 chars)
issued_at : i64      — unix timestamp
revoked   : bool     — true if revoked
bump      : u8
```

---

## 10. Security Notes

- **SBT freeze authority** is transferred to the config PDA after minting. No external party (not even the original authority) can unfreeze without a signed PDA instruction — which `sbt_program` deliberately does not expose.
- **Mint authority** is removed after minting (`set_authority → None`), ensuring the SBT supply is permanently 1.
- **Metadata is immutable** (`is_mutable: false`) for SBTs so the identity claim cannot be altered.
- All Anchor `has_one` and `seeds`/`bump` constraints guard against substitution attacks.
- String inputs are validated for maximum lengths to prevent account space overflows.

---

## 11. Troubleshooting

| Error | Solution |
|---|---|
| `insufficient funds` | Run `solana airdrop 2` |
| `IDL not found` | Run `anchor build` first |
| `already in use` on config | Config PDA already initialized — safe to ignore |
| `AccountNotFound` | Program not deployed, or wrong cluster |
| `custom program error: 0x11` | SBT transfer blocked by frozen account (Layer 2) — expected |
| `custom program error: 0x25` | SBT transfer blocked by NonTransferable extension (Layer 1) — expected |
| Build fails on Windows | Use WSL2 or Git Bash; Anchor doesn't support native Windows well |

---

## 12. References

- [Anchor Framework](https://www.anchor-lang.com/)
- [Solana SPL Token](https://spl.solana.com/token)
- [Metaplex Token Metadata](https://developers.metaplex.com/token-metadata)
- [Solana Devnet Explorer](https://explorer.solana.com/?cluster=devnet)
- [Solana Faucet](https://faucet.solana.com/)