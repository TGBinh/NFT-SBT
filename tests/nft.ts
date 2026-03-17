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

function deriveRwaIssuance(
  challengeId: number[],
  user: PublicKey,
  pid: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("rwa_issuance"),
      Buffer.from(challengeId),
      user.toBuffer(),
    ],
    pid
  )[0];
}

function deriveRwaRecord(mint: PublicKey, pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rwa_record"), mint.toBuffer()],
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

function deriveStampRecord(mint: PublicKey, pid: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stamp_record"), mint.toBuffer()],
    pid
  )[0];
}

function deriveMetadata(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  )[0];
}

function deriveMasterEdition(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    METADATA_PROGRAM_ID
  )[0];
}

async function airdrop(
  conn: anchor.web3.Connection,
  pk: PublicKey
): Promise<void> {
  try {
    const s = await conn.requestAirdrop(pk, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction({
      signature: s,
      ...(await conn.getLatestBlockhash()),
    });
  } catch {}
}

describe("nft_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NftProgram as Program<NftProgram>;
  const authority = (provider.wallet as anchor.Wallet).payer;
  const recipient = Keypair.generate();

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
        .updateRally(false)
        .accounts({
          rallyConfig: rallyConfigPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
      const cfg = await program.account.rallyConfig.fetch(rallyConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods
        .updateRally(true)
        .accounts({ rallyConfig: rallyConfigPda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
    });
  });

  describe("mint_rwa", () => {
    const challengeId = toId("challenge-001");
    let mintKp: Keypair;

    before(() => {
      mintKp = Keypair.generate();
    });

    it("mints RWA NFT and creates issuance + record PDAs", async () => {
      const rwaIssuance = deriveRwaIssuance(
        challengeId,
        recipient.publicKey,
        program.programId
      );
      const rwaRecord = deriveRwaRecord(mintKp.publicKey, program.programId);
      const tokenAccount = await getAssociatedTokenAddress(
        mintKp.publicKey,
        recipient.publicKey
      );

      await program.methods
        .mintRwa(
          "Kominka Stay",
          "RWA",
          "https://example.com/rwa.json",
          500,
          challengeId
        )
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: recipient.publicKey,
          rwaIssuance,
          rwaRecord,
          mint: mintKp.publicKey,
          tokenAccount,
          metadata: deriveMetadata(mintKp.publicKey),
          masterEdition: deriveMasterEdition(mintKp.publicKey),
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority, mintKp])
        .rpc();

      const rec = await program.account.rwaRecord.fetch(rwaRecord);
      assert.equal(rec.isUsed, false);
      assert.ok(rec.ownerAtMint.equals(recipient.publicKey));

      const bal = await getAccount(provider.connection, tokenAccount);
      assert.equal(bal.amount.toString(), "1");
    });

    it("rejects duplicate RWA mint for same (challenge, user)", async () => {
      const mintKp2 = Keypair.generate();
      try {
        await program.methods
          .mintRwa(
            "Kominka Stay 2",
            "RWA",
            "https://example.com/rwa2.json",
            500,
            challengeId
          )
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient.publicKey,
            rwaIssuance: deriveRwaIssuance(
              challengeId,
              recipient.publicKey,
              program.programId
            ),
            rwaRecord: deriveRwaRecord(mintKp2.publicKey, program.programId),
            mint: mintKp2.publicKey,
            tokenAccount: await getAssociatedTokenAddress(
              mintKp2.publicKey,
              recipient.publicKey
            ),
            metadata: deriveMetadata(mintKp2.publicKey),
            masterEdition: deriveMasterEdition(mintKp2.publicKey),
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, mintKp2])
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(
          e.message.includes("already in use") || e.message.includes("0x0")
        );
      }
    });
  });

  describe("mint_stamp", () => {
    const rallyId = toId("stamp-rally-1");
    const rallyIdBuf = Buffer.from(rallyId);

    before(async () => {
      try {
        await program.methods
          .createRally(
            rallyId,
            "Stamp Rally 1",
            "STMP",
            "https://example.com/stamp.json",
            "https://example.com/complete.json",
            3
          )
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: deriveRallyConfig(rallyId, program.programId),
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }
    });

    it("mints checkpoint 0 stamp", async () => {
      const mint = Keypair.generate();
      const stampParticipation = deriveStampParticipation(
        rallyId,
        0,
        authority.publicKey,
        program.programId
      );
      const stampRecord = deriveStampRecord(mint.publicKey, program.programId);
      const recipientAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );
      const metadata = deriveMetadata(mint.publicKey);
      const masterEdition = deriveMasterEdition(mint.publicKey);

      await program.methods
        .mintStamp(0, "Stamp #0", "STMP", 500)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: deriveRallyConfig(rallyId, program.programId),
          stampParticipation,
          stampRecord,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          mint: mint.publicKey,
          recipientTokenAccount: recipientAta,
          metadata,
          masterEdition,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority, mint])
        .rpc();

      const sp = await program.account.stampParticipation.fetch(stampParticipation);
      assert.ok(sp.user.equals(authority.publicKey));
      assert.equal(sp.checkpointIndex, 0);
      assert.deepEqual(sp.rallyId, rallyId);

      const sr = await program.account.stampRecord.fetch(stampRecord);
      assert.ok(sr.mint.equals(mint.publicKey));
      assert.equal(sr.checkpointIndex, 0);

      const bal = await getAccount(provider.connection, recipientAta);
      assert.equal(bal.amount.toString(), "1");
    });

    it("mints checkpoint 1 stamp", async () => {
      const mint = Keypair.generate();
      const stampParticipation = deriveStampParticipation(
        rallyId,
        1,
        authority.publicKey,
        program.programId
      );
      const stampRecord = deriveStampRecord(mint.publicKey, program.programId);
      const recipientAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );
      const metadata = deriveMetadata(mint.publicKey);
      const masterEdition = deriveMasterEdition(mint.publicKey);

      await program.methods
        .mintStamp(1, "Stamp #1", "STMP", 500)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: deriveRallyConfig(rallyId, program.programId),
          stampParticipation,
          stampRecord,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          mint: mint.publicKey,
          recipientTokenAccount: recipientAta,
          metadata,
          masterEdition,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority, mint])
        .rpc();

      const sp = await program.account.stampParticipation.fetch(stampParticipation);
      assert.ok(sp.user.equals(authority.publicKey));
      assert.equal(sp.checkpointIndex, 1);

      const sr = await program.account.stampRecord.fetch(stampRecord);
      assert.ok(sr.mint.equals(mint.publicKey));

      const bal = await getAccount(provider.connection, recipientAta);
      assert.equal(bal.amount.toString(), "1");
    });

    it("mints completion stamp (checkpoint_index=255)", async () => {
      const mint = Keypair.generate();
      const stampParticipation = deriveStampParticipation(
        rallyId,
        255,
        authority.publicKey,
        program.programId
      );
      const stampRecord = deriveStampRecord(mint.publicKey, program.programId);
      const recipientAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );
      const metadata = deriveMetadata(mint.publicKey);
      const masterEdition = deriveMasterEdition(mint.publicKey);

      await program.methods
        .mintStamp(255, "Completion", "STMP", 500)
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
          rallyConfig: deriveRallyConfig(rallyId, program.programId),
          stampParticipation,
          stampRecord,
          authority: authority.publicKey,
          recipient: authority.publicKey,
          mint: mint.publicKey,
          recipientTokenAccount: recipientAta,
          metadata,
          masterEdition,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority, mint])
        .rpc();

      const sp = await program.account.stampParticipation.fetch(stampParticipation);
      assert.ok(sp.user.equals(authority.publicKey));
      assert.equal(sp.checkpointIndex, 255);

      const bal = await getAccount(provider.connection, recipientAta);
      assert.equal(bal.amount.toString(), "1");
    });

    it("rejects duplicate stamp (same checkpoint, same recipient)", async () => {
      // checkpoint 0 was already minted for authority.publicKey in first test
      const mint = Keypair.generate();
      const stampParticipation = deriveStampParticipation(
        rallyId,
        0,
        authority.publicKey,
        program.programId
      );
      const stampRecord = deriveStampRecord(mint.publicKey, program.programId);
      const recipientAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );
      const metadata = deriveMetadata(mint.publicKey);
      const masterEdition = deriveMasterEdition(mint.publicKey);

      try {
        await program.methods
          .mintStamp(0, "Stamp #0 Dup", "STMP", 500)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: deriveRallyConfig(rallyId, program.programId),
            stampParticipation,
            stampRecord,
            authority: authority.publicKey,
            recipient: authority.publicKey,
            mint: mint.publicKey,
            recipientTokenAccount: recipientAta,
            metadata,
            masterEdition,
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, mint])
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(
          e.message.includes("already in use") || e.message.includes("0x0")
        );
      }
    });

    it("rejects invalid checkpoint_index (>=total_checkpoints and !=255)", async () => {
      const mint = Keypair.generate();
      const stampParticipation = deriveStampParticipation(
        rallyId,
        5,
        authority.publicKey,
        program.programId
      );
      const stampRecord = deriveStampRecord(mint.publicKey, program.programId);
      const recipientAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );
      const metadata = deriveMetadata(mint.publicKey);
      const masterEdition = deriveMasterEdition(mint.publicKey);

      try {
        await program.methods
          .mintStamp(5, "Invalid Stamp", "STMP", 500)
          .accounts({
            nftConfig: deriveNftConfig(CollectionType.StampRally, program.programId),
            rallyConfig: deriveRallyConfig(rallyId, program.programId),
            stampParticipation,
            stampRecord,
            authority: authority.publicKey,
            recipient: authority.publicKey,
            mint: mint.publicKey,
            recipientTokenAccount: recipientAta,
            metadata,
            masterEdition,
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([authority, mint])
          .rpc();
        assert.fail("Expected InvalidCheckpointIndex error");
      } catch (e: any) {
        assert.ok(
          e.message.includes("InvalidCheckpointIndex") ||
          e.message.includes("6007") ||
          e.error?.errorCode?.code === "InvalidCheckpointIndex"
        );
      }
    });
  });

  describe("use_rwa", () => {
    const challengeId = toId("challenge-use-test");
    const mint = Keypair.generate();

    before(async () => {
      // Mint an RWA so we have something to use
      const rwaIssuance = deriveRwaIssuance(
        challengeId,
        authority.publicKey,
        program.programId
      );
      const rwaRecord = deriveRwaRecord(mint.publicKey, program.programId);
      const tokenAccount = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );
      const metadata = deriveMetadata(mint.publicKey);
      const masterEdition = deriveMasterEdition(mint.publicKey);

      await program.methods
        .mintRwa(
          "RWA Use Test",
          "RWA",
          "https://example.com/rwa-use.json",
          0,
          challengeId
        )
        .accounts({
          nftConfig: deriveNftConfig(CollectionType.Rwa, program.programId),
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: authority.publicKey,
          rwaIssuance,
          rwaRecord,
          mint: mint.publicKey,
          tokenAccount,
          metadata,
          masterEdition,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority, mint])
        .rpc();
    });

    it("marks rwa as used", async () => {
      const rwaRecord = deriveRwaRecord(mint.publicKey, program.programId);
      const userAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );

      await program.methods
        .useRwa()
        .accounts({
          rwaRecord,
          mint: mint.publicKey,
          userTokenAccount: userAta,
          user: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const record = await program.account.rwaRecord.fetch(rwaRecord);
      assert.ok(record.isUsed, "isUsed should be true");
      assert.ok(record.usedAt.toNumber() > 0, "usedAt should be set");
    });

    it("rejects double use", async () => {
      const rwaRecord = deriveRwaRecord(mint.publicKey, program.programId);
      const userAta = await getAssociatedTokenAddress(
        mint.publicKey,
        authority.publicKey
      );

      try {
        await program.methods
          .useRwa()
          .accounts({
            rwaRecord,
            mint: mint.publicKey,
            userTokenAccount: userAta,
            user: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        assert.fail("Should have thrown AlreadyUsed");
      } catch (e: any) {
        assert.ok(
          e.message.includes("AlreadyUsed") ||
            e.error?.errorCode?.code === "AlreadyUsed",
          `Expected AlreadyUsed, got: ${e.message}`
        );
      }
    });
  });
});
