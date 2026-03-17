/**
 * mint-sbt.ts
 * Mints a Soulbound Token (SBT) on Solana Devnet using sbt_program (Token-2022).
 *
 * Usage:
 *   yarn mint:sbt [RECIPIENT_PUBKEY]
 *   ts-node scripts/mint-sbt.ts [RECIPIENT_PUBKEY]
 *
 * If RECIPIENT_PUBKEY is omitted, the deployer wallet is used as the recipient.
 *
 * Prerequisites:
 *   - sbt_program deployed to devnet (yarn deploy)
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
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// SBT metadata config — edit before minting
// ---------------------------------------------------------------------------
const SBT_CONFIG = {
  name: "Example SBT",
  symbol: "EXSBT",
  uri: "https://example.com/sbt-metadata.json",
  issuer: "Example DAO",
};

function deriveSbtRecordPDA(mint: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sbt_record"), mint.toBuffer()],
    programId
  );
  return pda;
}

// Token-2022 ATA derivation (different from legacy SPL Token ATA)
function getToken2022ATA(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("===================================================");
  console.log("   Mint SBT Script -- Solana Devnet (Token-2022)");
  console.log("===================================================\n");

  // Setup provider
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

  // Load IDL and program
  const idlPath = path.resolve(__dirname, "../target/idl/sbt_program.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}\nRun 'anchor build' first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const programKeypairPath = path.resolve(
    __dirname,
    "../target/deploy/sbt_program-keypair.json"
  );
  const programKpData = JSON.parse(
    fs.readFileSync(programKeypairPath, "utf-8")
  ) as number[];
  const programKp = Keypair.fromSecretKey(Uint8Array.from(programKpData));
  const programId = programKp.publicKey;

  const program = new Program(idl, programId, provider);
  console.log(`  Program:   ${programId.toBase58()}\n`);

  // Derive config PDA
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("sbt_config")],
    programId
  );

  // Check / initialize config
  try {
    await (program.account as any).sbtConfig.fetch(configPDA);
    console.log("  Config PDA already initialized:", configPDA.toBase58());
  } catch {
    console.log("  Initializing SBT Config PDA...");
    await (program.methods as any)
      .initializeConfig()
      .accounts({
        config: configPDA,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Config PDA initialized:", configPDA.toBase58());
  }

  // Generate fresh mint keypair (caller controls the address)
  const mintKeypair = Keypair.generate();
  console.log(`  New Mint:  ${mintKeypair.publicKey.toBase58()}`);

  // Derive all addresses
  const sbtRecord = deriveSbtRecordPDA(mintKeypair.publicKey, programId);

  // CRITICAL: Token-2022 ATA -- different address from legacy SPL Token ATA
  const tokenAccount = getToken2022ATA(mintKeypair.publicKey, recipientPubkey);

  console.log(`  SBT Record PDA: ${sbtRecord.toBase58()}`);
  console.log(`  Token Account:  ${tokenAccount.toBase58()} (Token-2022 ATA)`);

  // Mint SBT
  console.log("\n  Minting SBT...");
  console.log(`  Name:    ${SBT_CONFIG.name}`);
  console.log(`  Symbol:  ${SBT_CONFIG.symbol}`);
  console.log(`  URI:     ${SBT_CONFIG.uri}`);
  console.log(`  Issuer:  ${SBT_CONFIG.issuer}`);

  const tx = await (program.methods as any)
    .mintSbt(SBT_CONFIG.name, SBT_CONFIG.symbol, SBT_CONFIG.uri, SBT_CONFIG.issuer)
    .accounts({
      config: configPDA,
      authority: wallet.publicKey,
      recipient: recipientPubkey,
      mint: mintKeypair.publicKey,
      tokenAccount,
      sbtRecord,
      // SBT program uses Token-2022, NOT the legacy token program
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([mintKeypair])
    .rpc();

  // Verify Soulbound properties
  console.log("\n  Verifying Soulbound properties...");

  const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccount);
  const parsed = (tokenAccountInfo.value?.data as any)?.parsed;
  const tokenState: string = parsed?.info?.state ?? "unknown";
  const tokenBalance: number = parsed?.info?.tokenAmount?.uiAmount ?? -1;

  const mintInfo = await connection.getParsedAccountInfo(mintKeypair.publicKey);
  const mintParsed = (mintInfo.value?.data as any)?.parsed;
  const mintAuthority: string | null = mintParsed?.info?.mintAuthority ?? null;

  const record = await (program.account as any).sbtRecord.fetch(sbtRecord);

  // Output results
  console.log("\n===================================================");
  console.log("   SBT Minted Successfully!");
  console.log("===================================================");
  console.log(`  SBT Mint Address : ${mintKeypair.publicKey.toBase58()}`);
  console.log(`  Recipient        : ${recipientPubkey.toBase58()}`);
  console.log(`  Token Account    : ${tokenAccount.toBase58()}`);
  console.log(`  SBT Record PDA   : ${sbtRecord.toBase58()}`);
  console.log(`  Transaction      : ${tx}`);
  console.log();
  console.log("  -- On-chain SBT Record --");
  console.log(`  Owner      : ${record.owner.toBase58()}`);
  console.log(`  Mint       : ${record.mint.toBase58()}`);
  console.log(`  Name       : ${record.name}`);
  console.log(`  Symbol     : ${record.symbol}`);
  console.log(`  Issuer     : ${record.issuer}`);
  console.log(`  Issued At  : ${new Date(record.issuedAt.toNumber() * 1000).toISOString()}`);
  console.log(`  Revoked    : ${record.revoked}`);
  console.log();
  console.log("  -- Soulbound Verification --");
  console.log(`  Token Balance  : ${tokenBalance} (expected: 1)`);
  console.log(`  Account State  : ${tokenState} (expected: frozen)`);
  console.log(`  Mint Authority : ${mintAuthority ?? "null"} (expected: null)`);

  if (tokenState === "frozen") {
    console.log("\n  SOULBOUND VERIFIED: Token account is frozen.");
    console.log("  NonTransferable extension also blocks all Token-2022 transfers.");
  } else {
    console.log("\n  WARNING: Token account is NOT frozen! Check sbt_program logic.");
  }

  if (mintAuthority === null) {
    console.log("  SUPPLY LOCKED: Mint authority removed. Supply is permanently 1.");
  }

  console.log(
    `\n  Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log(
    `  Mint:     https://explorer.solana.com/address/${mintKeypair.publicKey.toBase58()}?cluster=devnet`
  );
  console.log();
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
