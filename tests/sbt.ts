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
        .updateEvent(false, null, null, null)
        .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods.updateEvent(true, null, null, null)
        .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey }).rpc();
    });

    it("rejects unauthorized update", async () => {
      const fake = Keypair.generate();
      await airdrop(provider.connection, fake.publicKey);
      try {
        await program.methods.updateEvent(false, null, null, null)
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
        .updateChallenge(false, null, null, null, null, null)
        .accounts({ challengeConfig: challengeConfigPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.challengeConfig.fetch(challengeConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods.updateChallenge(true, null, null, null, null, null)
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
      await program.methods.updateEvent(false, null, null, null)
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
        await program.methods.updateEvent(true, null, null, null)
          .accounts({ eventConfig: eventConfigPda, authority: authority.publicKey }).rpc();
      }
    });
  });

  describe("mint_challenge_accepted", () => {
    const challengeId = toId("test-challenge-001");
    const challengeConfigPda = deriveChallengeConfig(challengeId, program.programId);
    const recipient3 = Keypair.generate();
    let mintKp: Keypair;

    before(async () => {
      await airdrop(provider.connection, recipient3.publicKey);
      mintKp = Keypair.generate();
    });

    it("mints ChallengeAccepted SBT", async () => {
      const sbtRecord = deriveSbtRecord(mintKp.publicKey, program.programId);
      const participationPda = deriveParticipation(
        SbtType.ChallengeAccepted, challengeId, 0, recipient3.publicKey, program.programId
      );
      const tokenAccount = getToken2022ATA(mintKp.publicKey, recipient3.publicKey);

      await program.methods
        .mintChallengeAccepted("Bob", "ChallengeOrg")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          challengeConfig: challengeConfigPda,
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: recipient3.publicKey,
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
      assert.equal(record.sbtType, SbtType.ChallengeAccepted);
      assert.equal(record.missionIndex, 0);
    });

    it("rejects duplicate ChallengeAccepted SBT for same user+challenge", async () => {
      const mintKp2 = Keypair.generate();
      const participationPda = deriveParticipation(
        SbtType.ChallengeAccepted, challengeId, 0, recipient3.publicKey, program.programId
      );
      try {
        await program.methods
          .mintChallengeAccepted("Bob", "ChallengeOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            challengeConfig: challengeConfigPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient3.publicKey,
            sbtRecord: deriveSbtRecord(mintKp2.publicKey, program.programId),
            participationRecord: participationPda,
            mint: mintKp2.publicKey,
            tokenAccount: getToken2022ATA(mintKp2.publicKey, recipient3.publicKey),
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

  describe("mint_challenge_mission", () => {
    const challengeId = toId("test-challenge-001");
    const challengeConfigPda = deriveChallengeConfig(challengeId, program.programId);
    const recipient4 = Keypair.generate();

    before(async () => {
      await airdrop(provider.connection, recipient4.publicKey);
    });

    it("mints 3 mission SBTs and quest complete SBT without collision", async () => {
      for (const idx of [0, 1, 2, 255]) {
        const mintKp = Keypair.generate();
        const sbtRecord = deriveSbtRecord(mintKp.publicKey, program.programId);
        const participationPda = deriveParticipation(
          SbtType.ChallengeMission, challengeId, idx, recipient4.publicKey, program.programId
        );
        const tokenAccount = getToken2022ATA(mintKp.publicKey, recipient4.publicKey);

        await program.methods
          .mintChallengeMission(idx, "Carol", "ChallengeOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: challengeConfigPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient4.publicKey,
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
        assert.equal(record.sbtType, SbtType.ChallengeMission);
        assert.equal(record.missionIndex, idx);
      }
    });

    it("rejects out-of-range mission_index", async () => {
      const mintKp = Keypair.generate();
      const recipient5 = Keypair.generate();
      await airdrop(provider.connection, recipient5.publicKey);
      try {
        await program.methods
          .mintChallengeMission(100, "Dave", "ChallengeOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: challengeConfigPda,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient5.publicKey,
            sbtRecord: deriveSbtRecord(mintKp.publicKey, program.programId),
            participationRecord: deriveParticipation(SbtType.ChallengeMission, challengeId, 100, recipient5.publicKey, program.programId),
            mint: mintKp.publicKey,
            tokenAccount: getToken2022ATA(mintKp.publicKey, recipient5.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKp])
          .rpc();
        assert.fail("Expected InvalidMissionIndex");
      } catch (e: any) {
        assert.ok(e.message.includes("InvalidMissionIndex") || e.message.includes("2013"));
      }
    });
  });

  describe("revoke_sbt and verify_sbt", () => {
    // Uses mintKp from mint_human_capital test -- we need a fresh mint here
    const revokeRecipient = Keypair.generate();
    let revokeMintKp: Keypair;
    let revokeSbtRecord: PublicKey;
    let revokeTokenAccount: PublicKey;

    before(async () => {
      await airdrop(provider.connection, revokeRecipient.publicKey);
      revokeMintKp = Keypair.generate();
      revokeSbtRecord = deriveSbtRecord(revokeMintKp.publicKey, program.programId);
      revokeTokenAccount = getToken2022ATA(revokeMintKp.publicKey, revokeRecipient.publicKey);

      // Mint a Human Capital SBT to revoke
      const participationPda = deriveParticipation(
        SbtType.HumanCapital, toId(""), 0, revokeRecipient.publicKey, program.programId
      );
      await program.methods
        .mintHumanCapital("RevokeMeUser", "TestIssuer", "https://example.com/hc2.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: revokeRecipient.publicKey,
          sbtRecord: revokeSbtRecord,
          participationRecord: participationPda,
          mint: revokeMintKp.publicKey,
          tokenAccount: revokeTokenAccount,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([revokeMintKp])
        .rpc();
    });

    it("verify_sbt succeeds for valid SBT", async () => {
      await program.methods.verifySbt()
        .accounts({
          owner: revokeRecipient.publicKey,
          mint: revokeMintKp.publicKey,
          sbtRecord: revokeSbtRecord,
        })
        .rpc();
    });

    it("verify_sbt fails with wrong owner", async () => {
      const wrongOwner = Keypair.generate();
      try {
        await program.methods.verifySbt()
          .accounts({
            owner: wrongOwner.publicKey,
            mint: revokeMintKp.publicKey,
            sbtRecord: revokeSbtRecord,
          })
          .rpc();
        assert.fail("Expected NotOwner");
      } catch (e: any) {
        assert.ok(e.message.includes("NotOwner") || e.message.includes("2007"));
      }
    });

    it("revoke_sbt burns token and marks record revoked", async () => {
      await program.methods
        .revokeSbt(SbtType.HumanCapital)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
          authority: authority.publicKey,
          mint: revokeMintKp.publicKey,
          tokenAccount: revokeTokenAccount,
          sbtRecord: revokeSbtRecord,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const record = await program.account.sbtRecord.fetch(revokeSbtRecord);
      assert.equal(record.revoked, true);
    });

    it("verify_sbt fails after revocation", async () => {
      try {
        await program.methods.verifySbt()
          .accounts({
            owner: revokeRecipient.publicKey,
            mint: revokeMintKp.publicKey,
            sbtRecord: revokeSbtRecord,
          })
          .rpc();
        assert.fail("Expected SbtRevoked");
      } catch (e: any) {
        assert.ok(e.message.includes("SbtRevoked") || e.message.includes("2007"));
      }
    });

    it("revoke_sbt fails on already-revoked SBT", async () => {
      try {
        await program.methods
          .revokeSbt(SbtType.HumanCapital)
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
            authority: authority.publicKey,
            mint: revokeMintKp.publicKey,
            tokenAccount: revokeTokenAccount,
            sbtRecord: revokeSbtRecord,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Expected AlreadyRevoked");
      } catch (e: any) {
        assert.ok(e.message.includes("AlreadyRevoked") || e.message.includes("2005"));
      }
    });
  });

  describe("transfer_authority (sbt)", () => {
    it("Authority can transfer to new wallet and back", async () => {
      const newAuthority = Keypair.generate();
      const sbtType = 0; // HumanCapital
      const configPda = deriveSbtConfig(sbtType, program.programId);

      await program.methods
        .transferAuthority(sbtType, newAuthority.publicKey)
        .accounts({ config: configPda, authority: provider.wallet.publicKey })
        .rpc();

      const config = await program.account.sbtConfig.fetch(configPda);
      assert.strictEqual(config.authority.toBase58(), newAuthority.publicKey.toBase58());

      // Restore original authority
      await program.methods
        .transferAuthority(sbtType, provider.wallet.publicKey)
        .accounts({ config: configPda, authority: newAuthority.publicKey })
        .signers([newAuthority])
        .rpc();

      const restored = await program.account.sbtConfig.fetch(configPda);
      assert.strictEqual(restored.authority.toBase58(), provider.wallet.publicKey.toBase58());
    });

    it("Fail: non-authority cannot transfer", async () => {
      const impostor = Keypair.generate();
      const configPda = deriveSbtConfig(0, program.programId);
      try {
        await program.methods
          .transferAuthority(0, impostor.publicKey)
          .accounts({ config: configPda, authority: impostor.publicKey })
          .signers([impostor])
          .rpc();
        assert.fail("Should have thrown");
      } catch (e: any) {
        assert.include(e.message, "Unauthorized");
      }
    });
  });

  describe("update_event metadata", () => {
    const eventId = toId("event-meta-upd-01");
    const eventPda = deriveEventConfig(eventId, program.programId);

    before(async () => {
      try {
        await program.methods
          .createEvent(eventId, "OldName", "OLD", "https://old.json")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }
    });

    it("updates name, symbol, uri", async () => {
      await program.methods
        .updateEvent(true, "NewName", "NEW", "https://new.json")
        .accounts({ eventConfig: eventPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.eventConfig.fetch(eventPda);
      assert.equal(cfg.name, "NewName");
      assert.equal(cfg.symbol, "NEW");
      assert.equal(cfg.uri, "https://new.json");
      assert.isTrue(cfg.active);
    });

    it("passes null to keep existing values", async () => {
      await program.methods
        .updateEvent(false, null, null, null)
        .accounts({ eventConfig: eventPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.eventConfig.fetch(eventPda);
      assert.equal(cfg.name, "NewName"); // unchanged from previous test
      assert.isFalse(cfg.active);
      // restore
      await program.methods
        .updateEvent(true, null, null, null)
        .accounts({ eventConfig: eventPda, authority: authority.publicKey })
        .rpc();
    });
  });

  describe("update_challenge metadata", () => {
    const cid = toId("challenge-meta-01");
    const cPda = deriveChallengeConfig(cid, program.programId);

    before(async () => {
      try {
        await program.methods
          .createChallenge(cid, "OldC", "OC", "https://a.json", "https://b.json", "https://c.json", 2)
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            challengeConfig: cPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }
    });

    it("updates name and URIs", async () => {
      await program.methods
        .updateChallenge(true, "NewC", "NC", "https://a2.json", "https://b2.json", "https://c2.json")
        .accounts({ challengeConfig: cPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.challengeConfig.fetch(cPda);
      assert.equal(cfg.name, "NewC");
      assert.equal(cfg.uriAccepted, "https://a2.json");
      assert.equal(cfg.uriMission, "https://b2.json");
      assert.equal(cfg.uriComplete, "https://c2.json");
    });

    it("passes null to keep existing values", async () => {
      await program.methods
        .updateChallenge(false, null, null, null, null, null)
        .accounts({ challengeConfig: cPda, authority: authority.publicKey })
        .rpc();
      const cfg = await program.account.challengeConfig.fetch(cPda);
      assert.equal(cfg.name, "NewC"); // unchanged
      assert.isFalse(cfg.active);
      // restore
      await program.methods
        .updateChallenge(true, null, null, null, null, null)
        .accounts({ challengeConfig: cPda, authority: authority.publicKey })
        .rpc();
    });
  });

  describe("close_event", () => {
    it("authority can close an inactive event", async () => {
      const eid = toId("close-event-001");
      const ePda = deriveEventConfig(eid, program.programId);
      await program.methods
        .createEvent(eid, "CloseMe", "CL", "https://close.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: ePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      // deactivate
      await program.methods
        .updateEvent(false, null, null, null)
        .accounts({ eventConfig: ePda, authority: authority.publicKey })
        .rpc();
      // close
      await program.methods
        .closeEvent()
        .accounts({ eventConfig: ePda, authority: authority.publicKey })
        .rpc();
      const info = await provider.connection.getAccountInfo(ePda);
      assert.isNull(info, "EventConfig should be closed");
    });

    it("Fail: cannot close an active event", async () => {
      const eid = toId("close-active-evt");
      const ePda = deriveEventConfig(eid, program.programId);
      await program.methods
        .createEvent(eid, "Active", "ACT", "https://active.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: ePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      try {
        await program.methods
          .closeEvent()
          .accounts({ eventConfig: ePda, authority: authority.publicKey })
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

  describe("close_challenge", () => {
    it("authority can close an inactive challenge", async () => {
      const cid = toId("close-chal-001");
      const cPda = deriveChallengeConfig(cid, program.programId);
      await program.methods
        .createChallenge(cid, "CloseChallenge", "CC", "https://a.json", "https://b.json", "https://c.json", 2)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          challengeConfig: cPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await program.methods
        .updateChallenge(false, null, null, null, null, null)
        .accounts({ challengeConfig: cPda, authority: authority.publicKey })
        .rpc();
      await program.methods
        .closeChallenge()
        .accounts({ challengeConfig: cPda, authority: authority.publicKey })
        .rpc();
      const info = await provider.connection.getAccountInfo(cPda);
      assert.isNull(info, "ChallengeConfig should be closed");
    });
  });
});
