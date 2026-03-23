/**
 * mint-nft.ts
 * ──────────────────────────────────────────────────────────────
 * Demonstrates the RWA SFT flow on Solana Devnet using nft_program:
 *   1. initializeConfig(0)         — create NftConfig PDA
 *   2. createRwaMint(challengeId)  — create shared SFT mint + RwaConfig PDA
 *   3. mintRwa(challengeId)        — mint 1 token to recipient's ATA + RwaIssuance PDA
 *
 * Usage:
 *   yarn mint:nft [RECIPIENT_PUBKEY]
 *   # or
 *   ts-node scripts/mint-nft.ts [RECIPIENT_PUBKEY]
 *
 * Prerequisites:
 *   - nft_program deployed to devnet (yarn deploy)
 *   - ANCHOR_WALLET set, or ~/.config/solana/id.json exists
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ── Metaplex ───────────────────────────────────────────────────
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// ── Seeds ──────────────────────────────────────────────────────
const NFT_CONFIG_SEED = Buffer.from("nft_config");
const RWA_CONFIG_SEED = Buffer.from("rwa_config");
const RWA_ISSUANCE_SEED = Buffer.from("rwa_issuance");

// ── RWA configuration — edit before minting ───────────────────
const RWA_CONFIG = {
  name: "Example RWA Token",
  symbol: "RWA",
  uri: "https://example.com/rwa-metadata.json",
  royalty: 500, // 500 basis points = 5%
};

// ── PDA helpers ───────────────────────────────────────────────
function deriveNftConfigPDA(collectionType: number, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [NFT_CONFIG_SEED, Buffer.from([collectionType])],
    programId
  );
  return pda;
}

function deriveRwaConfigPDA(challengeId: Buffer, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [RWA_CONFIG_SEED, challengeId],
    programId
  );
  return pda;
}

function deriveRwaIssuancePDA(
  challengeId: Buffer,
  recipient: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [RWA_ISSUANCE_SEED, challengeId, recipient.toBuffer()],
    programId
  );
  return pda;
}

function deriveMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  return pda;
}

// ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("   Mint RWA SFT Script — Solana Devnet");
  console.log("═══════════════════════════════════════════════════\n");

  // ── 1. Setup provider ──────────────────────────────────────
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "~", ".config", "solana", "id.json");

  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found: ${walletPath}\nSet ANCHOR_WALLET env var.`);
  }

  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as number[];
  const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log(`  Authority: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`  Balance:   ${(balance / 1e9).toFixed(4)} SOL`);

  // Resolve recipient
  let recipientPubkey: PublicKey;
  const recipientArg = process.argv[2];
  if (recipientArg) {
    try {
      recipientPubkey = new PublicKey(recipientArg);
      console.log(`  Recipient: ${recipientPubkey.toBase58()} (from CLI arg)`);
    } catch {
      throw new Error(`Invalid recipient public key: ${recipientArg}`);
    }
  } else {
    recipientPubkey = wallet.publicKey;
    console.log(`  Recipient: ${recipientPubkey.toBase58()} (defaulting to authority)`);
  }

  // ── 2. Load IDL and program ────────────────────────────────
  const idlPath = path.resolve(__dirname, "../target/idl/nft_program.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}\nRun 'anchor build' first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const programKeypairPath = path.resolve(
    __dirname,
    "../target/deploy/nft_program-keypair.json"
  );
  const programKpData = JSON.parse(
    fs.readFileSync(programKeypairPath, "utf-8")
  ) as number[];
  const programKp = Keypair.fromSecretKey(Uint8Array.from(programKpData));
  const programId = programKp.publicKey;

  idl.address = programId.toBase58();
  const program = new Program(idl, provider);
  console.log(`  Program:   ${programId.toBase58()}\n`);

  // ── 3. NftConfig PDA (collection_type=0 for RWA) ──────────
  const nftConfigPDA = deriveNftConfigPDA(0, programId);

  try {
    await (program.account as any).nftConfig.fetch(nftConfigPDA);
    console.log("  NftConfig already initialized:", nftConfigPDA.toBase58());
  } catch {
    console.log("  Initializing NftConfig (type=0)...");
    await (program.methods as any)
      .initializeConfig(0)
      .accounts({
        config: nftConfigPDA,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  NftConfig initialized:", nftConfigPDA.toBase58());
  }

  // ── 4. Create shared RWA SFT mint ─────────────────────────
  // challengeId: 32-byte array (use a fixed demo value here)
  const challengeId = Buffer.alloc(32, 0);
  challengeId.writeUInt32BE(1, 28); // demo: challenge #1

  const rwaConfigPDA = deriveRwaConfigPDA(challengeId, programId);
  const mintKeypair = Keypair.generate();
  const metadata = deriveMetadataPDA(mintKeypair.publicKey);

  console.log(`  Challenge ID: ${challengeId.toString("hex")}`);
  console.log(`  RwaConfig PDA: ${rwaConfigPDA.toBase58()}`);
  console.log(`  Shared Mint:   ${mintKeypair.publicKey.toBase58()}`);
  console.log(`  Metadata PDA:  ${metadata.toBase58()}`);

  let rwaSftMint: PublicKey;
  try {
    const existingConfig = await (program.account as any).rwaConfig.fetch(rwaConfigPDA);
    rwaSftMint = existingConfig.sftMint;
    console.log(`\n  RwaConfig already exists. Shared mint: ${rwaSftMint.toBase58()}`);
  } catch {
    console.log("\n  Creating RWA SFT mint...");
    console.log(`  Name:    ${RWA_CONFIG.name}`);
    console.log(`  Symbol:  ${RWA_CONFIG.symbol}`);
    console.log(`  URI:     ${RWA_CONFIG.uri}`);
    console.log(`  Royalty: ${RWA_CONFIG.royalty / 100}%`);

    await (program.methods as any)
      .createRwaMint(
        Array.from(challengeId),
        RWA_CONFIG.name,
        RWA_CONFIG.symbol,
        RWA_CONFIG.uri,
        RWA_CONFIG.royalty
      )
      .accounts({
        nftConfig: nftConfigPDA,
        rwaConfig: rwaConfigPDA,
        mint: mintKeypair.publicKey,
        metadata,
        tokenMetadataProgram: METADATA_PROGRAM_ID,
        authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    rwaSftMint = mintKeypair.publicKey;
    console.log("  RWA SFT mint created:", rwaSftMint.toBase58());
  }

  // ── 5. Mint RWA token to recipient ────────────────────────
  const rwaIssuancePDA = deriveRwaIssuancePDA(challengeId, recipientPubkey, programId);
  const tokenAccount = getAssociatedTokenAddressSync(
    rwaSftMint,
    recipientPubkey,
    false,
    TOKEN_PROGRAM_ID
  );

  console.log(`\n  Minting RWA token to recipient...`);
  console.log(`  RwaIssuance PDA: ${rwaIssuancePDA.toBase58()}`);
  console.log(`  Token Account:   ${tokenAccount.toBase58()}`);

  const tx = await (program.methods as any)
    .mintRwa(Array.from(challengeId))
    .accounts({
      nftConfig: nftConfigPDA,
      rwaConfig: rwaConfigPDA,
      mint: rwaSftMint,
      rwaIssuance: rwaIssuancePDA,
      tokenAccount,
      authority: wallet.publicKey,
      recipient: recipientPubkey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  // ── 6. Verify results ──────────────────────────────────────
  const issuance = await (program.account as any).rwaIssuance.fetch(rwaIssuancePDA);
  const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccount);
  const parsedToken = (tokenAccountInfo.value?.data as any)?.parsed;
  const tokenBalance: number = parsedToken?.info?.tokenAmount?.uiAmount ?? -1;

  console.log("\n═══════════════════════════════════════════════════");
  console.log("   RWA SFT Minted Successfully!");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Shared Mint    : ${rwaSftMint.toBase58()}`);
  console.log(`  Recipient      : ${recipientPubkey.toBase58()}`);
  console.log(`  Token Account  : ${tokenAccount.toBase58()}`);
  console.log(`  RwaIssuance    : ${rwaIssuancePDA.toBase58()}`);
  console.log(`  Transaction    : ${tx}`);
  console.log();
  console.log("  -- On-chain RwaIssuance --");
  console.log(`  User       : ${issuance.user.toBase58()}`);
  console.log(`  Minted At  : ${new Date(issuance.mintedAt.toNumber() * 1000).toISOString()}`);
  console.log(`  Is Used    : ${issuance.isUsed}`);
  console.log();
  console.log("  -- Token Verification --");
  console.log(`  Balance    : ${tokenBalance} (expected: 1)`);
  console.log(
    `\n  Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log(
    `  Mint:     https://explorer.solana.com/address/${rwaSftMint.toBase58()}?cluster=devnet`
  );
  console.log();
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
