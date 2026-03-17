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
});
