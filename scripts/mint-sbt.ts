/**
 * mint-sbt.ts
 * Mints a HumanCapital SBT on Solana Devnet using sbt_program (Token-2022).
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
  name: "Example HumanCapital",
  uri: "https://example.com/hc-metadata.json",
  issuer: "Example DAO",
};

const SBT_CONFIG_SEED = Buffer.from("sbt_config");
const SBT_RECORD_SEED = Buffer.from("sbt_record");
const PARTICIPATION_SEED = Buffer.from("participation");

function deriveSbtConfigPDA(sbtType: number, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SBT_CONFIG_SEED, Buffer.from([sbtType])],
    programId
  );
  return pda;
}

// HumanCapital: seed = [sbt_record, mint_bytes, 0, recipient]
function deriveSbtRecordPDA(
  mintPubkey: PublicKey,
  recipient: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      SBT_RECORD_SEED,
      mintPubkey.toBuffer(),
      Buffer.from([0]),
      recipient.toBuffer(),
    ],
    programId
  );
  return pda;
}

// HumanCapital: seed = [participation, 0, [0u8;32], 0, recipient]
function deriveParticipationPDA(
  recipient: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      PARTICIPATION_SEED,
      Buffer.from([0]),
      Buffer.alloc(32, 0),
      Buffer.from([0]),
      recipient.toBuffer(),
    ],
    programId
  );
  return pda;
}

// Token-2022 ATA
function getToken2022ATA(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("===================================================");
  console.log("   Mint HumanCapital SBT -- Solana Devnet (Token-2022)");
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

  idl.address = programId.toBase58();
  const program = new Program(idl, provider);
  console.log(`  Program:   ${programId.toBase58()}\n`);

  // Derive SbtConfig PDA (type=0 for HumanCapital)
  const sbtConfigPDA = deriveSbtConfigPDA(0, programId);

  // Check / initialize SbtConfig (type=0)
  try {
    await (program.account as any).sbtConfig.fetch(sbtConfigPDA);
    console.log("  SbtConfig PDA already initialized:", sbtConfigPDA.toBase58());
  } catch {
    console.log("  Initializing SbtConfig PDA (type=0)...");
    await (program.methods as any)
      .initializeConfig(0)
      .accounts({
        config: sbtConfigPDA,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  SbtConfig PDA initialized:", sbtConfigPDA.toBase58());
  }

  // Generate fresh mint keypair (unique per HumanCapital recipient)
  const mintKeypair = Keypair.generate();
  console.log(`  New Mint:  ${mintKeypair.publicKey.toBase58()}`);

  // Derive all addresses
  const sbtRecord = deriveSbtRecordPDA(mintKeypair.publicKey, recipientPubkey, programId);
  const participationRecord = deriveParticipationPDA(recipientPubkey, programId);
  const tokenAccount = getToken2022ATA(mintKeypair.publicKey, recipientPubkey);

  console.log(`  SBT Record PDA:       ${sbtRecord.toBase58()}`);
  console.log(`  Participation Record: ${participationRecord.toBase58()}`);
  console.log(`  Token Account:        ${tokenAccount.toBase58()} (Token-2022 ATA)`);

  // Mint HumanCapital SBT
  console.log("\n  Minting HumanCapital SBT...");
  console.log(`  Name:    ${SBT_CONFIG.name}`);
  console.log(`  URI:     ${SBT_CONFIG.uri}`);
  console.log(`  Issuer:  ${SBT_CONFIG.issuer}`);

  const tx = await (program.methods as any)
    .mintHumanCapital(SBT_CONFIG.name, SBT_CONFIG.issuer, SBT_CONFIG.uri)
    .accounts({
      sbtConfig: sbtConfigPDA,
      authority: wallet.publicKey,
      payer: wallet.publicKey,
      recipient: recipientPubkey,
      sbtRecord,
      participationRecord,
      mint: mintKeypair.publicKey,
      tokenAccount,
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

  const record = await (program.account as any).sbtRecord.fetch(sbtRecord);

  // Output results
  console.log("\n===================================================");
  console.log("   HumanCapital SBT Minted Successfully!");
  console.log("===================================================");
  console.log(`  SBT Mint Address    : ${mintKeypair.publicKey.toBase58()}`);
  console.log(`  Recipient           : ${recipientPubkey.toBase58()}`);
  console.log(`  Token Account       : ${tokenAccount.toBase58()}`);
  console.log(`  SBT Record PDA      : ${sbtRecord.toBase58()}`);
  console.log(`  Participation Record: ${participationRecord.toBase58()}`);
  console.log(`  Transaction         : ${tx}`);
  console.log();
  console.log("  -- On-chain SBT Record --");
  console.log(`  Owner      : ${record.owner.toBase58()}`);
  console.log(`  SBT Type   : ${record.sbtType}`);
  console.log(`  Collection : ${Buffer.from(record.collectionId).toString("hex")}`);
  console.log(`  Issuer     : ${record.issuer}`);
  console.log(`  Issued At  : ${new Date(record.issuedAt.toNumber() * 1000).toISOString()}`);
  console.log(`  Revoked    : ${record.revoked}`);
  console.log();
  console.log("  -- Soulbound Verification --");
  console.log(`  Token Balance  : ${tokenBalance} (expected: 1)`);
  console.log(`  Account State  : ${tokenState} (expected: frozen)`);

  if (tokenState === "frozen") {
    console.log("\n  SOULBOUND VERIFIED: Token account is frozen.");
    console.log("  NonTransferable extension also blocks all Token-2022 transfers.");
  } else {
    console.log("\n  WARNING: Token account is NOT frozen! Check sbt_program logic.");
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
