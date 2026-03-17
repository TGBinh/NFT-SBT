/**
 * mint-nft.ts
 * ──────────────────────────────────────────────────────────────
 * Mints a new NFT on Solana Devnet using the deployed nft_program.
 *
 * Usage:
 *   yarn mint:nft
 *   # or
 *   ts-node scripts/mint-nft.ts
 *
 * Prerequisites:
 *   - nft_program deployed to devnet
 *   - ANCHOR_WALLET env var pointing to your keypair JSON file
 *     (defaults to ~/.config/solana/id.json)
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
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ── Metaplex ───────────────────────────────────────────────────
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function deriveMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  return pda;
}

function deriveMasterEditionPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    METADATA_PROGRAM_ID
  );
  return pda;
}

// ── NFT configuration (edit these values) ─────────────────────
const NFT_CONFIG = {
  name: "Example NFT",
  symbol: "EXNFT",
  uri: "https://example.com/nft-metadata.json", // Replace with your IPFS/Arweave URI
  royalty: 500, // 500 basis points = 5%
};

// ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("   Mint NFT Script — Solana Devnet");
  console.log("═══════════════════════════════════════════════════\n");

  // ── 1. Setup provider ──────────────────────────────────────
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load wallet from env or default path
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

  console.log(`  Wallet:  ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`  Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  // ── 2. Load IDL and program ────────────────────────────────
  const idlPath = path.resolve(__dirname, "../target/idl/nft_program.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}\nRun 'anchor build' first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  // Read program ID from target/deploy keypair
  const programKeypairPath = path.resolve(
    __dirname,
    "../target/deploy/nft_program-keypair.json"
  );
  const programKpData = JSON.parse(
    fs.readFileSync(programKeypairPath, "utf-8")
  ) as number[];
  const programKp = Keypair.fromSecretKey(Uint8Array.from(programKpData));
  const programId = programKp.publicKey;

  const program = new Program(idl, programId, provider);
  console.log(`  Program: ${programId.toBase58()}\n`);

  // ── 3. Derive config PDA ───────────────────────────────────
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_config")],
    programId
  );

  // ── 4. Check / initialize config ──────────────────────────
  try {
    await (program.account as any).nftConfig.fetch(configPDA);
    console.log("  Config PDA already initialized:", configPDA.toBase58());
  } catch {
    console.log("  Initializing Config PDA...");
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

  // ── 5. Generate mint keypair ───────────────────────────────
  const mintKeypair = Keypair.generate();
  console.log(`  New Mint Keypair: ${mintKeypair.publicKey.toBase58()}`);

  // ── 6. Derive PDAs ─────────────────────────────────────────
  const metadata = deriveMetadataPDA(mintKeypair.publicKey);
  const masterEdition = deriveMasterEditionPDA(mintKeypair.publicKey);
  const tokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    wallet.publicKey
  );

  console.log(`  Metadata PDA:     ${metadata.toBase58()}`);
  console.log(`  Master Edition:   ${masterEdition.toBase58()}`);
  console.log(`  Token Account:    ${tokenAccount.toBase58()}`);

  // ── 7. Mint NFT ────────────────────────────────────────────
  console.log("\n  Minting NFT...");
  console.log(`  Name:    ${NFT_CONFIG.name}`);
  console.log(`  Symbol:  ${NFT_CONFIG.symbol}`);
  console.log(`  URI:     ${NFT_CONFIG.uri}`);
  console.log(`  Royalty: ${NFT_CONFIG.royalty / 100}%`);

  const tx = await (program.methods as any)
    .mintNft(NFT_CONFIG.name, NFT_CONFIG.symbol, NFT_CONFIG.uri, NFT_CONFIG.royalty)
    .accounts({
      config: configPDA,
      authority: wallet.publicKey,
      payer: wallet.publicKey,
      mint: mintKeypair.publicKey,
      tokenAccount,
      metadata,
      masterEdition,
      tokenMetadataProgram: METADATA_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([mintKeypair])
    .rpc();

  // ── 8. Output results ──────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("   NFT Minted Successfully!");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  NFT Mint Address : ${mintKeypair.publicKey.toBase58()}`);
  console.log(`  Metadata PDA     : ${metadata.toBase58()}`);
  console.log(`  Master Edition   : ${masterEdition.toBase58()}`);
  console.log(`  Token Account    : ${tokenAccount.toBase58()}`);
  console.log(`  Transaction      : ${tx}`);
  console.log(
    `  Explorer         : https://explorer.solana.com/tx/${tx}?cluster=devnet`
  );
  console.log(
    `  NFT Explorer     : https://explorer.solana.com/address/${mintKeypair.publicKey.toBase58()}?cluster=devnet`
  );
  console.log("\n  Save the Mint Address — you'll need it to transfer or verify.");
  console.log();
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
