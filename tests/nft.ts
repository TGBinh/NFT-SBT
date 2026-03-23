import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NftProgram } from "../target/types/nft_program";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const CollectionType = { Rwa: 0, StampRally: 1 };

function toId(s: string): number[] {
  const buf = Buffer.alloc(32);
  Buffer.from(s.slice(0, 32)).copy(buf);
  return Array.from(buf);
}

function deriveNftConfig(ct: number, pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nft_config"), Buffer.from([ct])],
    pid
  )[0];
}

function deriveRallyConfig(rallyId: number[], pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rally_config"), Buffer.from(rallyId)],
    pid
  )[0];
}

function deriveRwaConfig(challengeId: number[], pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rwa_config"), Buffer.from(challengeId)],
    pid
  )[0];
}

function deriveRwaIssuance(challengeId: number[], user: PublicKey, pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rwa_issuance"), Buffer.from(challengeId), user.toBuffer()],
    pid
  )[0];
}

function deriveCheckpointMint(rallyId: number[], checkpointIndex: number, pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("checkpoint_mint"), Buffer.from(rallyId), Buffer.from([checkpointIndex])],
    pid
  )[0];
}

function deriveStampParticipation(
  rallyId: number[],
  checkpointIndex: number,
  user: PublicKey,
  pid: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("stamp_participation"),
      Buffer.from(rallyId),
      Buffer.from([checkpointIndex]),
      user.toBuffer(),
    ],
    pid
  )[0];
}

function deriveMetadata(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

async function airdrop(conn: anchor.web3.Connection, pk: PublicKey): Promise<void> {
  try {
    const s = await conn.requestAirdrop(pk, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction({ signature: s, ...(await conn.getLatestBlockhash()) });
  } catch {}
}

describe("nft_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NftProgram as Program<NftProgram>;
  const authority = (provider.wallet as anchor.Wallet).payer;
  const recipient = Keypair.generate();

  // Shared state: RWA mint for each challenge_id, checkpoint mints per rally
  let rwaSftMint: PublicKey;           // set by create_rwa_mint
  let checkpointMints: Map<number, PublicKey> = new Map(); // checkpointIndex → sft_mint

  before(async () => {
    await airdrop(provider.connection, recipient.publicKey);
  });

  describe("initialize_config", () => {
    it("creates NftConfig for RWA and StampRally", async () => {
      for (const ct of [CollectionType.Rwa, CollectionType.StampRally]) {
        try {
          await program.methods
            .initializeConfig(ct)
            .accounts({
              config: deriveNftConfig(ct, program.programId),
              authority: authority.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([authority])
            .rpc();
        } catch (e: any) {
          if (!e.message?.includes("already in use")) throw e;
        }
        const cfg = await program.account.nftConfig.fetch(
          deriveNftConfig(ct, program.programId)
        );
        assert.equal(cfg.collectionType, ct);
      }
    });
  });

  describe("create_rally", () => {
    const rallyId = toId("test-rally-001");
    const rallyConfigPda = deriveRallyConfig(rallyId, program.programId);

    it("creates RallyConfig PDA", async () => {
      try {
        await program.methods
          .createRally(
            rallyId,
            "Test Rally",
            "RLY",
            "https://example.com/stamp.json",
            "https://example.com/complete.json",
            3
          )
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: rallyConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }

      const cfg = await program.account.rallyConfig.fetch(rallyConfigPda);
      assert.equal(cfg.name, "Test Rally");
      assert.equal(cfg.totalCheckpoints, 3);
      assert.equal(cfg.active, true);
    });

    it("update_rally sets active = false", async () => {
      await program.methods
        .updateRally(false, null, null, null, null)
        .accounts({ rallyConfig: rallyConfigPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      const cfg = await program.account.rallyConfig.fetch(rallyConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods
        .updateRally(true, null, null, null, null)
        .accounts({ rallyConfig: rallyConfigPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
    });
  });

  describe("create_rwa_mint + mint_rwa", () => {
    const challengeId = toId("challenge-001");
    const rwaConfigPda = deriveRwaConfig(challengeId, program.programId);
    let rwaMintKp: Keypair;

    before(async () => {
      rwaMintKp = Keypair.generate();
      // create_rwa_mint: creates shared SFT mint for this challenge
      try {
        await program.methods
          .createRwaMint(challengeId, "Kominka Stay", "RWA", "https://example.com/rwa.json", 500)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
            rwaConfig: rwaConfigPda,
            mint: rwaMintKp.publicKey,
            metadata: deriveMetadata(rwaMintKp.publicKey),
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            authority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, rwaMintKp])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }
      const cfg = await program.account.rwaConfig.fetch(rwaConfigPda);
      rwaSftMint = cfg.sftMint;
    });

    it("mints RWA SFT to recipient and creates issuance PDA", async () => {
      const rwaIssuance = deriveRwaIssuance(challengeId, recipient.publicKey, program.programId);
      const tokenAccount = getAssociatedTokenAddressSync(rwaSftMint, recipient.publicKey);

      await program.methods
        .mintRwa(challengeId)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
          rwaConfig: rwaConfigPda,
          mint: rwaSftMint,
          rwaIssuance,
          tokenAccount,
          authority: authority.publicKey,
          recipient: recipient.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const issuance = await program.account.rwaIssuance.fetch(rwaIssuance);
      assert.ok(issuance.user.equals(recipient.publicKey));
      assert.equal(issuance.isUsed, false);

      const bal = await getAccount(provider.connection, tokenAccount);
      assert.equal(bal.amount.toString(), "1");
    });

    it("rejects duplicate RWA mint for same (challenge, user)", async () => {
      const rwaIssuance = deriveRwaIssuance(challengeId, recipient.publicKey, program.programId);
      const tokenAccount = getAssociatedTokenAddressSync(rwaSftMint, recipient.publicKey);
      try {
        await program.methods
          .mintRwa(challengeId)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
            rwaConfig: rwaConfigPda,
            mint: rwaSftMint,
            rwaIssuance,
            tokenAccount,
            authority: authority.publicKey,
            recipient: recipient.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority])
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(e.message.includes("already in use") || e.message.includes("0x0"));
      }
    });
  });

  describe("create_stamp_mint + mint_stamp", () => {
    const rallyId = toId("stamp-rally-1");
    const rallyConfigPda = deriveRallyConfig(rallyId, program.programId);

    before(async () => {
      // Ensure rally exists
      try {
        await program.methods
          .createRally(
            rallyId, "Stamp Rally 1", "STMP",
            "https://example.com/stamp.json",
            "https://example.com/complete.json",
            3
          )
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: rallyConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }

      // create_stamp_mint for checkpoints 0, 1, 2, 255
      for (const idx of [0, 1, 2, 255]) {
        const stampMintKp = Keypair.generate();
        const cpMintPda = deriveCheckpointMint(rallyId, idx, program.programId);
        try {
          await program.methods
            .createStampMint(idx)
            .accounts({
              nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
              rallyConfig: rallyConfigPda,
              checkpointMintAccount: cpMintPda,
              mint: stampMintKp.publicKey,
              metadata: deriveMetadata(stampMintKp.publicKey),
              tokenMetadataProgram: METADATA_PROGRAM_ID,
              authority: authority.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              rent: SYSVAR_RENT_PUBKEY,
            })
            .signers([authority, stampMintKp])
            .rpc();
        } catch (e: any) {
          if (!e.message?.includes("already in use")) throw e;
        }
        const cp = await program.account.checkpointMint.fetch(cpMintPda);
        checkpointMints.set(idx, cp.sftMint);
      }
    });

    it("mints checkpoint 0 stamp", async () => {
      const cpMint = checkpointMints.get(0)!;
      const cpMintPda = deriveCheckpointMint(rallyId, 0, program.programId);
      const stampParticipation = deriveStampParticipation(rallyId, 0, authority.publicKey, program.programId);
      const recipientAta = getAssociatedTokenAddressSync(cpMint, authority.publicKey);

      await program.methods
        .mintStamp(0)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: rallyConfigPda,
          checkpointMintAccount: cpMintPda,
          mint: cpMint,
          stampParticipation,
          tokenAccount: recipientAta,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const sp = await program.account.stampParticipation.fetch(stampParticipation);
      assert.ok(sp.user.equals(authority.publicKey));
      assert.equal(sp.checkpointIndex, 0);

      const bal = await getAccount(provider.connection, recipientAta);
      assert.equal(bal.amount.toString(), "1");
    });

    it("mints checkpoint 1 stamp", async () => {
      const cpMint = checkpointMints.get(1)!;
      const cpMintPda = deriveCheckpointMint(rallyId, 1, program.programId);
      const stampParticipation = deriveStampParticipation(rallyId, 1, authority.publicKey, program.programId);
      const recipientAta = getAssociatedTokenAddressSync(cpMint, authority.publicKey);

      await program.methods
        .mintStamp(1)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: rallyConfigPda,
          checkpointMintAccount: cpMintPda,
          mint: cpMint,
          stampParticipation,
          tokenAccount: recipientAta,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const sp = await program.account.stampParticipation.fetch(stampParticipation);
      assert.ok(sp.user.equals(authority.publicKey));
      assert.equal(sp.checkpointIndex, 1);
    });

    it("mints completion stamp (checkpoint_index=255)", async () => {
      const cpMint = checkpointMints.get(255)!;
      const cpMintPda = deriveCheckpointMint(rallyId, 255, program.programId);
      const stampParticipation = deriveStampParticipation(rallyId, 255, authority.publicKey, program.programId);
      const recipientAta = getAssociatedTokenAddressSync(cpMint, authority.publicKey);

      await program.methods
        .mintStamp(255)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: rallyConfigPda,
          checkpointMintAccount: cpMintPda,
          mint: cpMint,
          stampParticipation,
          tokenAccount: recipientAta,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const sp = await program.account.stampParticipation.fetch(stampParticipation);
      assert.equal(sp.checkpointIndex, 255);
    });

    it("rejects duplicate stamp (same checkpoint, same recipient)", async () => {
      const cpMint = checkpointMints.get(0)!;
      const cpMintPda = deriveCheckpointMint(rallyId, 0, program.programId);
      const stampParticipation = deriveStampParticipation(rallyId, 0, authority.publicKey, program.programId);
      const recipientAta = getAssociatedTokenAddressSync(cpMint, authority.publicKey);
      try {
        await program.methods
          .mintStamp(0)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: rallyConfigPda,
            checkpointMintAccount: cpMintPda,
            mint: cpMint,
            stampParticipation,
            tokenAccount: recipientAta,
            authority: authority.publicKey,
            recipient: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority])
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(e.message.includes("already in use") || e.message.includes("0x0"));
      }
    });

    it("rejects invalid checkpoint_index (>=total_checkpoints and !=255)", async () => {
      // Need to create a stamp mint for index 5 first, but it doesn't exist → MintNotCreated
      // Alternatively, use a wrong mint pubkey. The checkpoint_mint_account PDA won't exist.
      const cpMintPda = deriveCheckpointMint(rallyId, 5, program.programId);
      const fakeMint = Keypair.generate();
      const stampParticipation = deriveStampParticipation(rallyId, 5, authority.publicKey, program.programId);
      const recipientAta = getAssociatedTokenAddressSync(fakeMint.publicKey, authority.publicKey);
      try {
        await program.methods
          .mintStamp(5)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: rallyConfigPda,
            checkpointMintAccount: cpMintPda,
            mint: fakeMint.publicKey,
            stampParticipation,
            tokenAccount: recipientAta,
            authority: authority.publicKey,
            recipient: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority])
          .rpc();
        assert.fail("Expected error");
      } catch (e: any) {
        // Will fail because InvalidCheckpointIndex (handler check) or AccountNotInitialized (PDA doesn't exist)
        assert.ok(
          e.message.includes("InvalidCheckpointIndex") ||
          e.message.includes("AccountNotInitialized") ||
          e.message.includes("0x")
        );
      }
    });
  });

  describe("use_rwa", () => {
    const challengeId = toId("challenge-use-test");
    const rwaConfigPda = deriveRwaConfig(challengeId, program.programId);
    let useMintKp: Keypair;
    let useRwaSftMint: PublicKey;

    before(async () => {
      useMintKp = Keypair.generate();
      // create rwa mint for this challenge
      try {
        await program.methods
          .createRwaMint(challengeId, "RWA Use Test", "RWA", "https://example.com/rwa-use.json", 0)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
            rwaConfig: rwaConfigPda,
            mint: useMintKp.publicKey,
            metadata: deriveMetadata(useMintKp.publicKey),
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            authority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, useMintKp])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }
      const cfg = await program.account.rwaConfig.fetch(rwaConfigPda);
      useRwaSftMint = cfg.sftMint;

      // mint to authority
      const rwaIssuance = deriveRwaIssuance(challengeId, authority.publicKey, program.programId);
      const tokenAccount = getAssociatedTokenAddressSync(useRwaSftMint, authority.publicKey);
      try {
        await program.methods
          .mintRwa(challengeId)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
            rwaConfig: rwaConfigPda,
            mint: useRwaSftMint,
            rwaIssuance,
            tokenAccount,
            authority: authority.publicKey,
            recipient: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }
    });

    it("marks rwa as used", async () => {
      const rwaIssuance = deriveRwaIssuance(challengeId, authority.publicKey, program.programId);
      const userAta = getAssociatedTokenAddressSync(useRwaSftMint, authority.publicKey);

      await program.methods
        .useRwa(challengeId)
        .accounts({
          rwaIssuance,
          rwaConfig: rwaConfigPda,
          mint: useRwaSftMint,
          userTokenAccount: userAta,
          user: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      const issuance = await program.account.rwaIssuance.fetch(rwaIssuance);
      assert.isTrue(issuance.isUsed, "isUsed should be true");
      assert.ok(issuance.usedAt.toNumber() > 0, "usedAt should be set");
    });

    it("rejects double use", async () => {
      const rwaIssuance = deriveRwaIssuance(challengeId, authority.publicKey, program.programId);
      const userAta = getAssociatedTokenAddressSync(useRwaSftMint, authority.publicKey);
      try {
        await program.methods
          .useRwa(challengeId)
          .accounts({
            rwaIssuance,
            rwaConfig: rwaConfigPda,
            mint: useRwaSftMint,
            userTokenAccount: userAta,
            user: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([authority])
          .rpc();
        assert.fail("Should have thrown AlreadyUsed");
      } catch (e: any) {
        assert.ok(
          e.message.includes("AlreadyUsed") || e.error?.errorCode?.code === "AlreadyUsed",
          `Expected AlreadyUsed, got: ${e.message}`
        );
      }
    });
  });

  describe("transfer_authority (nft)", () => {
    it("authority can transfer to new wallet and back", async () => {
      const newAuth = Keypair.generate();
      const ct = CollectionType.Rwa;
      const configPda = deriveNftConfig(ct, program.programId);

      await program.methods
        .transferAuthority(ct, newAuth.publicKey)
        .accounts({ config: configPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();

      const cfg = await program.account.nftConfig.fetch(configPda);
      assert.strictEqual(cfg.authority.toBase58(), newAuth.publicKey.toBase58());

      // Restore
      await program.methods
        .transferAuthority(ct, authority.publicKey)
        .accounts({ config: configPda, authority: newAuth.publicKey })
        .signers([newAuth])
        .rpc();

      const restored = await program.account.nftConfig.fetch(configPda);
      assert.strictEqual(restored.authority.toBase58(), authority.publicKey.toBase58());
    });

    it("Fail: non-authority cannot transfer", async () => {
      const impostor = Keypair.generate();
      const configPda = deriveNftConfig(CollectionType.Rwa, program.programId);
      try {
        await program.methods
          .transferAuthority(CollectionType.Rwa, impostor.publicKey)
          .accounts({ config: configPda, authority: impostor.publicKey })
          .signers([impostor])
          .rpc();
        assert.fail("Should have thrown");
      } catch (e: any) {
        assert.include(e.message, "Unauthorized");
      }
    });
  });

  describe("pause_program (nft)", () => {
    const challengeId = toId("challenge-001");
    const rwaConfigPda = deriveRwaConfig(challengeId, program.programId);
    let pauseTestMint: PublicKey;

    it("pauses and unpauses RWA type", async () => {
      const configPda = deriveNftConfig(CollectionType.Rwa, program.programId);
      await program.methods
        .pauseProgram(CollectionType.Rwa, true)
        .accounts({ config: configPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();

      const paused = await program.account.nftConfig.fetch(configPda);
      assert.isTrue(paused.paused);

      // Mint should fail while paused
      const r2 = Keypair.generate();
      await airdrop(provider.connection, r2.publicKey);

      // fetch existing rwa config to get sft_mint
      const cfg = await program.account.rwaConfig.fetch(rwaConfigPda);
      pauseTestMint = cfg.sftMint;
      const tokenAccount = getAssociatedTokenAddressSync(pauseTestMint, r2.publicKey);
      const rwaIssuance2 = deriveRwaIssuance(challengeId, r2.publicKey, program.programId);
      try {
        await program.methods
          .mintRwa(challengeId)
          .accounts({
            nftConfig: configPda,
            rwaConfig: rwaConfigPda,
            mint: pauseTestMint,
            rwaIssuance: rwaIssuance2,
            tokenAccount,
            authority: authority.publicKey,
            recipient: r2.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority])
          .rpc();
        assert.fail("Expected ProgramPaused");
      } catch (e: any) {
        assert.ok(e.message.includes("ProgramPaused") || e.message.includes("6014") || e.message.includes("MintNotCreated"));
      }

      // Unpause
      await program.methods
        .pauseProgram(CollectionType.Rwa, false)
        .accounts({ config: configPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      const unpaused = await program.account.nftConfig.fetch(configPda);
      assert.isFalse(unpaused.paused);
    });
  });

  describe("update_rally metadata", () => {
    const rid = toId("rally-meta-upd-01");
    const rPda = deriveRallyConfig(rid, program.programId);

    before(async () => {
      try {
        await program.methods
          .createRally(rid, "OldRally", "OR", "https://old-s.json", "https://old-c.json", 3)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: rPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }
    });

    it("updates name, symbol, URIs", async () => {
      await program.methods
        .updateRally(true, "NewRally", "NR", "https://new-s.json", "https://new-c.json")
        .accounts({ rallyConfig: rPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      const cfg = await program.account.rallyConfig.fetch(rPda);
      assert.equal(cfg.name, "NewRally");
      assert.equal(cfg.symbol, "NR");
      assert.equal(cfg.uriStamp, "https://new-s.json");
      assert.equal(cfg.uriComplete, "https://new-c.json");
    });

    it("passes null to keep existing values", async () => {
      await program.methods
        .updateRally(false, null, null, null, null)
        .accounts({ rallyConfig: rPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      const cfg = await program.account.rallyConfig.fetch(rPda);
      assert.equal(cfg.name, "NewRally"); // unchanged
      assert.isFalse(cfg.active);
      // restore
      await program.methods
        .updateRally(true, null, null, null, null)
        .accounts({ rallyConfig: rPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
    });
  });

  describe("burn_rwa", () => {
    const burnChallengeId = toId("burn-rwa-001");
    const burnRwaConfigPda = deriveRwaConfig(burnChallengeId, program.programId);
    let burnMintKp: Keypair;
    let burnRwaSftMint: PublicKey;

    before(async () => {
      burnMintKp = Keypair.generate();
      try {
        await program.methods
          .createRwaMint(burnChallengeId, "Burn RWA", "BRWA", "https://burn.json", 0)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
            rwaConfig: burnRwaConfigPda,
            mint: burnMintKp.publicKey,
            metadata: deriveMetadata(burnMintKp.publicKey),
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            authority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, burnMintKp])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }
      const cfg = await program.account.rwaConfig.fetch(burnRwaConfigPda);
      burnRwaSftMint = cfg.sftMint;

      // mint to recipient
      const rwaIssuance = deriveRwaIssuance(burnChallengeId, recipient.publicKey, program.programId);
      const tokenAccount = getAssociatedTokenAddressSync(burnRwaSftMint, recipient.publicKey);
      await program.methods
        .mintRwa(burnChallengeId)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
          rwaConfig: burnRwaConfigPda,
          mint: burnRwaSftMint,
          rwaIssuance,
          tokenAccount,
          authority: authority.publicKey,
          recipient: recipient.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();
    });

    it("recipient can burn RWA SFT and close issuance PDA", async () => {
      const rwaIssuance = deriveRwaIssuance(burnChallengeId, recipient.publicKey, program.programId);
      const recipientAta = getAssociatedTokenAddressSync(burnRwaSftMint, recipient.publicKey);

      await program.methods
        .burnRwa(burnChallengeId)
        .accounts({
          rwaIssuance,
          rwaConfig: burnRwaConfigPda,
          mint: burnRwaSftMint,
          userTokenAccount: recipientAta,
          user: recipient.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const info = await provider.connection.getAccountInfo(rwaIssuance);
      assert.isNull(info, "RwaIssuance should be closed after burn");
    });
  });

  describe("burn_stamp", () => {
    const burnRallyId = toId("burn-stamp-rl-01");
    const burnRallyConfigPda = deriveRallyConfig(burnRallyId, program.programId);
    let burnStampMint: PublicKey;

    before(async () => {
      // Create rally
      try {
        await program.methods
          .createRally(burnRallyId, "BurnRally", "BR", "https://bs.json", "https://bc.json", 3)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: burnRallyConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }

      // Create stamp mint for checkpoint 0
      const stampMintKp = Keypair.generate();
      const cpMintPda = deriveCheckpointMint(burnRallyId, 0, program.programId);
      try {
        await program.methods
          .createStampMint(0)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: burnRallyConfigPda,
            checkpointMintAccount: cpMintPda,
            mint: stampMintKp.publicKey,
            metadata: deriveMetadata(stampMintKp.publicKey),
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            authority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, stampMintKp])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }

      const cp = await program.account.checkpointMint.fetch(cpMintPda);
      burnStampMint = cp.sftMint;

      // Mint stamp to authority
      const stampParticipation = deriveStampParticipation(burnRallyId, 0, authority.publicKey, program.programId);
      const authorityAta = getAssociatedTokenAddressSync(burnStampMint, authority.publicKey);
      await program.methods
        .mintStamp(0)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: burnRallyConfigPda,
          checkpointMintAccount: cpMintPda,
          mint: burnStampMint,
          stampParticipation,
          tokenAccount: authorityAta,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();
    });

    it("holder can burn Stamp and close StampParticipation", async () => {
      const stampParticipation = deriveStampParticipation(burnRallyId, 0, authority.publicKey, program.programId);
      const cpMintPda = deriveCheckpointMint(burnRallyId, 0, program.programId);
      const authorityAta = getAssociatedTokenAddressSync(burnStampMint, authority.publicKey);

      await program.methods
        .burnStamp(0)
        .accounts({
          stampParticipation,
          rallyConfig: burnRallyConfigPda,
          checkpointMintAccount: cpMintPda,
          mint: burnStampMint,
          userTokenAccount: authorityAta,
          user: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      const info = await provider.connection.getAccountInfo(stampParticipation);
      assert.isNull(info, "StampParticipation should be closed after burn");
    });
  });

  describe("close_rally", () => {
    it("authority can close an inactive rally", async () => {
      const rid = toId("close-rally-001");
      const rPda = deriveRallyConfig(rid, program.programId);
      await program.methods
        .createRally(rid, "CloseRally", "CR", "https://cs.json", "https://cc.json", 2)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: rPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      await program.methods
        .updateRally(false, null, null, null, null)
        .accounts({ rallyConfig: rPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      await program.methods
        .closeRally()
        .accounts({ rallyConfig: rPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      const info = await provider.connection.getAccountInfo(rPda);
      assert.isNull(info, "RallyConfig should be closed");
    });

    it("Fail: cannot close an active rally", async () => {
      const rid = toId("close-active-rl");
      const rPda = deriveRallyConfig(rid, program.programId);
      await program.methods
        .createRally(rid, "ActiveRally", "AR", "https://as.json", "https://ac.json", 2)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: rPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      try {
        await program.methods
          .closeRally()
          .accounts({ rallyConfig: rPda, authority: authority.publicKey })
          .signers([authority])
          .rpc();
        assert.fail("Should have thrown");
      } catch (e: any) {
        assert.ok(
          e.message.includes("StillActive") || e.error?.errorCode?.code === "StillActive",
          `Expected StillActive, got: ${e.message}`
        );
      }
    });
  });
});
