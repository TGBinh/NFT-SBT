/**
 * deploy.ts
 * ──────────────────────────────────────────────────────────────
 * Builds both Anchor programs and deploys them to Solana Devnet.
 *
 * Usage:
 *   yarn deploy
 *   # or
 *   ts-node scripts/deploy.ts
 *
 * Requirements:
 *   - `anchor build` must have been run (or we run it here via child_process)
 *   - Solana CLI configured: `solana config set --url devnet`
 *   - Wallet funded with devnet SOL
 */

import { execSync } from "child_process";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const DEVNET_URL = clusterApiUrl("devnet");
const connection = new Connection(DEVNET_URL, "confirmed");

function runCommand(cmd: string, label: string): string {
  console.log(`\n[${label}] Running: ${cmd}`);
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    console.log(output.trim());
    return output.trim();
  } catch (err: any) {
    console.error(`[${label}] FAILED:\n${err.stderr || err.message}`);
    process.exit(1);
  }
}

async function readProgramId(programName: string): Promise<PublicKey | null> {
  const keypairPath = path.resolve(
    __dirname,
    `../target/deploy/${programName}-keypair.json`
  );
  if (!fs.existsSync(keypairPath)) {
    console.warn(`  Keypair not found: ${keypairPath}`);
    return null;
  }
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8")) as number[];
  const { Keypair } = await import("@solana/web3.js");
  const kp = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  return kp.publicKey;
}

async function checkBalance(): Promise<void> {
  const configOutput = execSync("solana config get", { encoding: "utf-8" });
  const walletMatch = configOutput.match(/Keypair Path:\s+(.+)/);
  if (!walletMatch) {
    console.warn("  Could not determine wallet path from solana config");
    return;
  }
  const walletPath = walletMatch[1].trim();
  if (!fs.existsSync(walletPath)) {
    console.warn(`  Wallet not found at: ${walletPath}`);
    return;
  }
  const { Keypair } = await import("@solana/web3.js");
  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as number[];
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const balance = await connection.getBalance(wallet.publicKey);
  const solBalance = balance / 1e9;
  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  Balance: ${solBalance.toFixed(4)} SOL`);
  if (solBalance < 2) {
    console.warn(
      "  WARNING: Low balance. Request airdrop with:\n" +
        "  solana airdrop 2 --url devnet"
    );
  }
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("   Solana Token Project — Deploy Script");
  console.log("═══════════════════════════════════════════════════");

  // ── 1. Switch to devnet ────────────────────────────────────
  runCommand("solana config set --url devnet", "Config");

  // ── 2. Check wallet balance ────────────────────────────────
  console.log("\n[Balance] Checking deployer wallet...");
  await checkBalance();

  // ── 3. Build programs ──────────────────────────────────────
  runCommand("anchor build", "Build");

  // ── 4. Deploy programs ─────────────────────────────────────
  runCommand("anchor deploy --provider.cluster devnet", "Deploy");

  // ── 5. Print deployed program IDs ──────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("   Deployed Program IDs");
  console.log("═══════════════════════════════════════════════════");

  const nftProgramId = await readProgramId("nft_program");
  const sbtProgramId = await readProgramId("sbt_program");

  if (nftProgramId) {
    console.log(`  NFT Program ID : ${nftProgramId.toBase58()}`);
    console.log(
      `  Explorer (NFT) : https://explorer.solana.com/address/${nftProgramId.toBase58()}?cluster=devnet`
    );
  }

  if (sbtProgramId) {
    console.log(`  SBT Program ID : ${sbtProgramId.toBase58()}`);
    console.log(
      `  Explorer (SBT) : https://explorer.solana.com/address/${sbtProgramId.toBase58()}?cluster=devnet`
    );
  }

  console.log("\n[NEXT STEPS]");
  console.log(
    "  1. Copy the Program IDs above into Anchor.toml under [programs.devnet]"
  );
  console.log("  2. Update declare_id!(...) in each programs/*/src/lib.rs");
  console.log("  3. Rebuild: anchor build");
  console.log("  4. Run tests: anchor test --skip-local-validator");
  console.log("  5. Mint NFT:  yarn mint:nft");
  console.log("  6. Mint SBT:  yarn mint:sbt");
  console.log("\n  Deploy complete!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
