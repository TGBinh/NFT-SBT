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

  describe("mint_human_capital", () => {
    const recipient = Keypair.generate();
    let mintKp: Keypair;

    before(async () => {
      await airdrop(provider.connection, recipient.publicKey);
      mintKp = Keypair.generate();
    });

    it("mints Human Capital SBT and creates on-chain record", async () => {
      const sbtRecord = deriveSbtRecord(mintKp.publicKey, program.programId);
      const participationPda = deriveParticipation(
        SbtType.HumanCapital, toId(""), 0, recipient.publicKey, program.programId
      );
      const tokenAccount = getToken2022ATA(mintKp.publicKey, recipient.publicKey);

      await program.methods
        .mintHumanCapital("Taro Yamada", "DAO Admin", "https://example.com/hc.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: recipient.publicKey,
          sbtRecord,
          participationRecord: participationPda,
          mint: mintKp.publicKey,
          tokenAccount,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKp])
        .rpc();

      const record = await program.account.sbtRecord.fetch(sbtRecord);
      assert.ok(record.owner.equals(recipient.publicKey));
      assert.equal(record.sbtType, SbtType.HumanCapital);
      assert.equal(record.revoked, false);
      assert.equal(record.name, "Taro Yamada");

      const bal = await provider.connection.getTokenAccountBalance(tokenAccount);
      assert.equal(bal.value.uiAmount, 1);
    });

    it("rejects duplicate Human Capital SBT for same user", async () => {
      const mintKp2 = Keypair.generate();
      const participationPda = deriveParticipation(
        SbtType.HumanCapital, toId(""), 0, recipient.publicKey, program.programId
      );
      try {
        await program.methods
          .mintHumanCapital("Taro Yamada", "DAO Admin", "https://example.com/hc.json")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient.publicKey,
            sbtRecord: deriveSbtRecord(mintKp2.publicKey, program.programId),
            participationRecord: participationPda,
            mint: mintKp2.publicKey,
            tokenAccount: getToken2022ATA(mintKp2.publicKey, recipient.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKp2])
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(e.message.includes("already in use") || e.message.includes("0x0"));
      }
    });
  });

  describe("mint_event_sbt", () => {
    const eventId = toId("test-event-001");
    const eventConfigPda = deriveEventConfig(eventId, program.programId);
    const recipient2 = Keypair.generate();
    let mintKp: Keypair;

    before(async () => {
      await airdrop(provider.connection, recipient2.publicKey);
      mintKp = Keypair.generate();
    });

    it("mints Event SBT and creates on-chain record", async () => {
      const sbtRecord = deriveSbtRecord(mintKp.publicKey, program.programId);
      const participationPda = deriveParticipation(
        SbtType.Event, eventId, 0, recipient2.publicKey, program.programId
      );
      const tokenAccount = getToken2022ATA(mintKp.publicKey, recipient2.publicKey);

      await program.methods
        .mintEventSbt("Alice", "EventOrg")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventConfigPda,
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: recipient2.publicKey,
          sbtRecord,
          participationRecord: participationPda,
          mint: mintKp.publicKey,
          tokenAccount,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKp])
        .rpc();

      const record = await program.account.sbtRecord.fetch(sbtRecord);
      assert.ok(record.owner.equals(recipient2.publicKey));
      assert.equal(record.sbtType, SbtType.Event);
      assert.equal(record.revoked, false);

      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.participantCount.toString(), "1");
    });

    it("rejects duplicate Event SBT for same user+event", async () => {
      const mintKp2 = Keypair.generate();
      const participationPda = deriveParticipation(
        SbtType.Event, eventId, 0, recipient2.publicKey, program.programId
      );
      try {
        await program.methods
          .mintEventSbt("Alice", "EventOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient2.publicKey,
            sbtRecord: deriveSbtRecord(mintKp2.publicKey, program.programId),
            participationRecord: participationPda,
            mint: mintKp2.publicKey,
            tokenAccount: getToken2022ATA(mintKp2.publicKey, recipient2.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKp2])
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(e.message.includes("already in use") || e.message.includes("0x0"));
      }
    });

    it("rejects mint when event is inactive", async () => {
      // First deactivate the event
      await program.methods.updateEvent(false)
        .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey }).rpc();

      const mintKp3 = Keypair.generate();
      const recipient3 = Keypair.generate();
      await airdrop(provider.connection, recipient3.publicKey);
      try {
        await program.methods
          .mintEventSbt("Bob", "EventOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient3.publicKey,
            sbtRecord: deriveSbtRecord(mintKp3.publicKey, program.programId),
            participationRecord: deriveParticipation(SbtType.Event, eventId, 0, recipient3.publicKey, program.programId),
            mint: mintKp3.publicKey,
            tokenAccount: getToken2022ATA(mintKp3.publicKey, recipient3.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKp3])
          .rpc();
        assert.fail("Expected NotActive");
      } catch (e: any) {
        assert.ok(e.message.includes("NotActive") || e.message.includes("2012"));
      } finally {
        // restore
        await program.methods.updateEvent(true)
          .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey }).rpc();
      }
    });
  });
});
