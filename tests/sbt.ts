import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SbtProgram } from "../target/types/sbt_program";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

// SBT type constants matching the Rust enum
const SbtType = { HumanCapital: 0, Event: 1, ChallengeAccepted: 2, ChallengeMission: 3 };

function toId(s: string): number[] {
  const buf = Buffer.alloc(32);
  Buffer.from(s.slice(0, 32)).copy(buf);
  return Array.from(buf);
}

function deriveSbtConfig(sbtType: number, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sbt_config"), Buffer.from([sbtType])],
    programId
  )[0];
}

function deriveEventConfig(eventId: number[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("event_config"), Buffer.from(eventId)],
    programId
  )[0];
}

function deriveChallengeConfig(challengeId: number[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("challenge_config"), Buffer.from(challengeId)],
    programId
  )[0];
}

function deriveSbtRecord(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sbt_record"), mint.toBuffer()],
    programId
  )[0];
}

function deriveParticipation(
  sbtType: number,
  collectionId: number[],
  missionIndex: number,
  user: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("participation"),
      Buffer.from([sbtType]),
      Buffer.from(collectionId),
      Buffer.from([missionIndex]),
      user.toBuffer(),
    ],
    programId
  )[0];
}

function getToken2022ATA(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

async function airdrop(connection: anchor.web3.Connection, pubkey: PublicKey): Promise<void> {
  try {
    const sig = await connection.requestAirdrop(pubkey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const lb = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...lb });
  } catch { /* ignore devnet rate limit */ }
}

describe("sbt_program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SbtProgram as Program<SbtProgram>;
  const authority = provider.wallet as anchor.Wallet;

  describe("initialize_config", () => {
    it("creates SbtConfig PDA for HumanCapital type", async () => {
      const configPda = deriveSbtConfig(SbtType.HumanCapital, program.programId);
      try {
        await program.methods
          .initializeConfig(SbtType.HumanCapital)
          .accounts({ config: configPda, authority: authority.publicKey, systemProgram: SystemProgram.programId })
          .rpc();
      } catch (e: any) {
        if (!e.message?.includes("already in use")) throw e;
      }
      const config = await program.account.sbtConfig.fetch(configPda);
      assert.ok(config.authority.equals(authority.publicKey));
      assert.equal(config.sbtType, SbtType.HumanCapital);
      assert.equal(config.sbtCount.toString(), "0");
    });

    it("creates separate PDAs for each type", async () => {
      for (const type of [SbtType.Event, SbtType.ChallengeAccepted, SbtType.ChallengeMission]) {
        const configPda = deriveSbtConfig(type, program.programId);
        try {
          await program.methods
            .initializeConfig(type)
            .accounts({ config: configPda, authority: authority.publicKey, systemProgram: SystemProgram.programId })
            .rpc();
        } catch (e: any) {
          if (!e.message?.includes("already in use")) throw e;
        }
        const config = await program.account.sbtConfig.fetch(configPda);
        assert.equal(config.sbtType, type);
      }
    });
  });

  describe("create_event", () => {
    const eventId = toId("test-event-001");
    const eventConfigPda = deriveEventConfig(eventId, program.programId);

    it("creates EventConfig PDA", async () => {
      try {
        await program.methods
          .createEvent(eventId, "Test Event", "EVT", "https://example.com/event.json")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }

      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.name, "Test Event");
      assert.equal(cfg.active, true);
      assert.equal(cfg.participantCount.toString(), "0");
    });

    it("update_event sets active = false", async () => {
      await program.methods
        .updateEvent(false)
        .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods.updateEvent(true)
        .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey }).rpc();
    });

    it("rejects unauthorized update", async () => {
      const fake = Keypair.generate();
      await airdrop(provider.connection, fake.publicKey);
      try {
        await program.methods.updateEvent(false)
          .accounts({ eventConfig: eventConfigPda, authority: fake.publicKey })
          .signers([fake]).rpc();
        assert.fail("Expected Unauthorized");
      } catch (e: any) {
        assert.ok(e.message.includes("Unauthorized") || e.message.includes("2006"));
      }
    });
  });

  describe("create_challenge", () => {
    const challengeId = toId("test-challenge-001");
    const challengeConfigPda = deriveChallengeConfig(challengeId, program.programId);

    it("creates ChallengeConfig PDA", async () => {
      try {
        await program.methods
          .createChallenge(
            challengeId,
            "Test Challenge",
            "CHG",
            "https://example.com/accepted.json",
            "https://example.com/mission.json",
            "https://example.com/complete.json",
            3
          )
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            challengeConfig: challengeConfigPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }

      const cfg = await program.account.challengeConfig.fetch(challengeConfigPda);
      assert.equal(cfg.name, "Test Challenge");
      assert.equal(cfg.totalMissions, 3);
      assert.equal(cfg.active, true);
      assert.equal(cfg.participantCount.toString(), "0");
    });

    it("update_challenge sets active = false", async () => {
      await program.methods
        .updateChallenge(false)
        .accounts({ challengeConfig: challengeConfigPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.challengeConfig.fetch(challengeConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods.updateChallenge(true)
        .accounts({ challengeConfig: challengeConfigPda, authority: authority.publicKey }).rpc();
    });

    it("rejects invalid total_missions (0)", async () => {
      const badId = toId("bad-challenge-000");
      try {
        await program.methods
          .createChallenge(
            badId,
            "Bad Challenge",
            "BAD",
            "https://example.com/a.json",
            "https://example.com/m.json",
            "https://example.com/c.json",
            0
          )
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            challengeConfig: deriveChallengeConfig(badId, program.programId),
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Expected InvalidTotalMissions");
      } catch (e: any) {
        assert.ok(e.message.includes("InvalidTotalMissions") || e.message.includes("2013"));
      }
    });
  });
});
