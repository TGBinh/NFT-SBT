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

// SFT model: seed = [sbt_record, collection_id (32b), mission_index, user]
function deriveSbtRecord(
  collectionId: number[] | Uint8Array,
  missionIndex: number,
  user: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("sbt_record"),
      Buffer.from(collectionId),
      Buffer.from([missionIndex]),
      user.toBuffer(),
    ],
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

  // Shared SFT mints set by create_event / create_challenge, used by subsequent tests
  let eventSftMint: PublicKey;
  let challengeAcceptedMint: PublicKey;
  let challengeMissionMint: PublicKey;
  let challengeCompleteMint: PublicKey;

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

    it("creates EventConfig PDA with SFT mint", async () => {
      const sftMintKp = Keypair.generate();
      try {
        await program.methods
          .createEvent(eventId, "Test Event", "EVT", "https://example.com/event.json")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            sftMint: sftMintKp.publicKey,
            authority: authority.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([sftMintKp])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }

      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.name, "Test Event");
      assert.equal(cfg.active, true);
      assert.equal(cfg.participantCount.toString(), "0");
      eventSftMint = cfg.sftMint; // store for later tests
    });

    it("update_event sets active = false", async () => {
      await program.methods
        .updateEvent(false, null, null, null)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventConfigPda,
          sftMint: eventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods.updateEvent(true, null, null, null)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventConfigPda,
          sftMint: eventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    });

    it("rejects unauthorized update", async () => {
      const fake = Keypair.generate();
      await airdrop(provider.connection, fake.publicKey);
      try {
        await program.methods.updateEvent(false, null, null, null)
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            sftMint: eventSftMint,
            authority: fake.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
          })
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

    it("creates ChallengeConfig PDA with 3 SFT mints", async () => {
      const sftAccKp = Keypair.generate();
      const sftMisKp = Keypair.generate();
      const sftComKp = Keypair.generate();
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
            sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: challengeConfigPda,
            sftAcceptedMint: sftAccKp.publicKey,
            sftMissionMint: sftMisKp.publicKey,
            sftCompleteMint: sftComKp.publicKey,
            authority: authority.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([sftAccKp, sftMisKp, sftComKp])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }

      const cfg = await program.account.challengeConfig.fetch(challengeConfigPda);
      assert.equal(cfg.name, "Test Challenge");
      assert.equal(cfg.totalMissions, 3);
      assert.equal(cfg.active, true);
      assert.equal(cfg.participantCount.toString(), "0");
      // store for later tests
      challengeAcceptedMint = cfg.sftAcceptedMint;
      challengeMissionMint = cfg.sftMissionMint;
      challengeCompleteMint = cfg.sftCompleteMint;
    });

    it("update_challenge sets active = false", async () => {
      await program.methods
        .updateChallenge(false, null, null, null, null, null)
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: challengeConfigPda,
          sftAcceptedMint: challengeAcceptedMint,
          sftMissionMint: challengeMissionMint,
          sftCompleteMint: challengeCompleteMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      const cfg = await program.account.challengeConfig.fetch(challengeConfigPda);
      assert.equal(cfg.active, false);
      // restore
      await program.methods.updateChallenge(true, null, null, null, null, null)
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: challengeConfigPda,
          sftAcceptedMint: challengeAcceptedMint,
          sftMissionMint: challengeMissionMint,
          sftCompleteMint: challengeCompleteMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    });

    it("rejects invalid total_missions (0)", async () => {
      const badId = toId("bad-challenge-000");
      const m1 = Keypair.generate(), m2 = Keypair.generate(), m3 = Keypair.generate();
      try {
        await program.methods
          .createChallenge(
            badId, "Bad Challenge", "BAD",
            "https://example.com/a.json",
            "https://example.com/m.json",
            "https://example.com/c.json",
            0
          )
          .accounts({
            sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: deriveChallengeConfig(badId, program.programId),
            sftAcceptedMint: m1.publicKey,
            sftMissionMint: m2.publicKey,
            sftCompleteMint: m3.publicKey,
            authority: authority.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([m1, m2, m3])
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
      // HC uses mint pubkey bytes as collection_id (unique per user)
      const collectionId = Array.from(mintKp.publicKey.toBytes());
      const sbtRecord = deriveSbtRecord(collectionId, 0, recipient.publicKey, program.programId);
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
            sbtRecord: deriveSbtRecord(Array.from(mintKp2.publicKey.toBytes()), 0, recipient.publicKey, program.programId),
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

    before(async () => {
      await airdrop(provider.connection, recipient2.publicKey);
    });

    it("mints Event SBT using shared SFT mint", async () => {
      const sbtRecord = deriveSbtRecord(eventId, 0, recipient2.publicKey, program.programId);
      const participationPda = deriveParticipation(
        SbtType.Event, eventId, 0, recipient2.publicKey, program.programId
      );
      const tokenAccount = getToken2022ATA(eventSftMint, recipient2.publicKey);

      await program.methods
        .mintEventSbt("EventOrg")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventConfigPda,
          sftMint: eventSftMint,
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: recipient2.publicKey,
          sbtRecord,
          participationRecord: participationPda,
          tokenAccount,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const record = await program.account.sbtRecord.fetch(sbtRecord);
      assert.ok(record.owner.equals(recipient2.publicKey));
      assert.equal(record.sbtType, SbtType.Event);
      assert.equal(record.revoked, false);

      const cfg = await program.account.eventConfig.fetch(eventConfigPda);
      assert.equal(cfg.participantCount.toString(), "1");
    });

    it("rejects duplicate Event SBT for same user+event", async () => {
      const participationPda = deriveParticipation(
        SbtType.Event, eventId, 0, recipient2.publicKey, program.programId
      );
      try {
        await program.methods
          .mintEventSbt("EventOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            sftMint: eventSftMint,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient2.publicKey,
            sbtRecord: deriveSbtRecord(eventId, 0, recipient2.publicKey, program.programId),
            participationRecord: participationPda,
            tokenAccount: getToken2022ATA(eventSftMint, recipient2.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Expected duplicate rejection");
      } catch (e: any) {
        assert.ok(e.message.includes("already in use") || e.message.includes("0x0"));
      }
    });

    it("rejects mint when event is inactive", async () => {
      await program.methods.updateEvent(false, null, null, null)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventConfigPda,
          sftMint: eventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const recipient3 = Keypair.generate();
      await airdrop(provider.connection, recipient3.publicKey);
      try {
        await program.methods
          .mintEventSbt("EventOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            sftMint: eventSftMint,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient3.publicKey,
            sbtRecord: deriveSbtRecord(eventId, 0, recipient3.publicKey, program.programId),
            participationRecord: deriveParticipation(SbtType.Event, eventId, 0, recipient3.publicKey, program.programId),
            tokenAccount: getToken2022ATA(eventSftMint, recipient3.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Expected NotActive");
      } catch (e: any) {
        assert.ok(e.message.includes("NotActive") || e.message.includes("2012"));
      } finally {
        await program.methods.updateEvent(true, null, null, null)
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventConfigPda,
            sftMint: eventSftMint,
            authority: authority.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
      }
    });
  });

  describe("mint_challenge_accepted", () => {
    const challengeId = toId("test-challenge-001");
    const challengeConfigPda = deriveChallengeConfig(challengeId, program.programId);
    const recipient3 = Keypair.generate();

    before(async () => {
      await airdrop(provider.connection, recipient3.publicKey);
    });

    it("mints ChallengeAccepted SBT using shared accepted mint", async () => {
      const sbtRecord = deriveSbtRecord(challengeId, 0, recipient3.publicKey, program.programId);
      const participationPda = deriveParticipation(
        SbtType.ChallengeAccepted, challengeId, 0, recipient3.publicKey, program.programId
      );
      const tokenAccount = getToken2022ATA(challengeAcceptedMint, recipient3.publicKey);

      await program.methods
        .mintChallengeAccepted("ChallengeOrg")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          challengeConfig: challengeConfigPda,
          sftMint: challengeAcceptedMint,
          authority: authority.publicKey,
          payer: authority.publicKey,
          recipient: recipient3.publicKey,
          sbtRecord,
          participationRecord: participationPda,
          tokenAccount,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const record = await program.account.sbtRecord.fetch(sbtRecord);
      assert.equal(record.sbtType, SbtType.ChallengeAccepted);
      assert.equal(record.missionIndex, 0);
    });

    it("rejects duplicate ChallengeAccepted SBT for same user+challenge", async () => {
      const participationPda = deriveParticipation(
        SbtType.ChallengeAccepted, challengeId, 0, recipient3.publicKey, program.programId
      );
      try {
        await program.methods
          .mintChallengeAccepted("ChallengeOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            challengeConfig: challengeConfigPda,
            sftMint: challengeAcceptedMint,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient3.publicKey,
            sbtRecord: deriveSbtRecord(challengeId, 0, recipient3.publicKey, program.programId),
            participationRecord: participationPda,
            tokenAccount: getToken2022ATA(challengeAcceptedMint, recipient3.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
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
        const sbtRecord = deriveSbtRecord(challengeId, idx, recipient4.publicKey, program.programId);
        const participationPda = deriveParticipation(
          SbtType.ChallengeMission, challengeId, idx, recipient4.publicKey, program.programId
        );
        // idx=255 uses the complete mint, others use mission mint
        const sftMint = idx === 255 ? challengeCompleteMint : challengeMissionMint;
        const tokenAccount = getToken2022ATA(sftMint, recipient4.publicKey);

        await program.methods
          .mintChallengeMission(idx, "ChallengeOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: challengeConfigPda,
            sftMint,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient4.publicKey,
            sbtRecord,
            participationRecord: participationPda,
            tokenAccount,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        const record = await program.account.sbtRecord.fetch(sbtRecord);
        assert.equal(record.sbtType, SbtType.ChallengeMission);
        assert.equal(record.missionIndex, idx);
      }
    });

    it("rejects out-of-range mission_index", async () => {
      const recipient5 = Keypair.generate();
      await airdrop(provider.connection, recipient5.publicKey);
      try {
        await program.methods
          .mintChallengeMission(100, "ChallengeOrg")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: challengeConfigPda,
            sftMint: challengeMissionMint,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: recipient5.publicKey,
            sbtRecord: deriveSbtRecord(challengeId, 100, recipient5.publicKey, program.programId),
            participationRecord: deriveParticipation(SbtType.ChallengeMission, challengeId, 100, recipient5.publicKey, program.programId),
            tokenAccount: getToken2022ATA(challengeMissionMint, recipient5.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Expected InvalidMissionIndex");
      } catch (e: any) {
        assert.ok(e.message.includes("InvalidMissionIndex") || e.message.includes("2013"));
      }
    });
  });

  describe("revoke_sbt and verify_sbt", () => {
    const revokeRecipient = Keypair.generate();
    let revokeMintKp: Keypair;
    let revokeSbtRecord: PublicKey;
    let revokeCollectionId: number[];
    let revokeTokenAccount: PublicKey;

    before(async () => {
      await airdrop(provider.connection, revokeRecipient.publicKey);
      revokeMintKp = Keypair.generate();
      revokeCollectionId = Array.from(revokeMintKp.publicKey.toBytes());
      revokeSbtRecord = deriveSbtRecord(revokeCollectionId, 0, revokeRecipient.publicKey, program.programId);
      revokeTokenAccount = getToken2022ATA(revokeMintKp.publicKey, revokeRecipient.publicKey);

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
      await program.methods
        .verifySbt(revokeCollectionId, 0)
        .accounts({
          owner: revokeRecipient.publicKey,
          sbtRecord: revokeSbtRecord,
        })
        .rpc();
    });

    it("verify_sbt fails with non-existent record (wrong owner)", async () => {
      const wrongOwner = Keypair.generate();
      // derives a PDA that doesn't exist → AccountNotInitialized
      const wrongRecord = deriveSbtRecord(revokeCollectionId, 0, wrongOwner.publicKey, program.programId);
      try {
        await program.methods
          .verifySbt(revokeCollectionId, 0)
          .accounts({
            owner: wrongOwner.publicKey,
            sbtRecord: wrongRecord,
          })
          .rpc();
        assert.fail("Expected error");
      } catch (e: any) {
        assert.ok(e.message.length > 0, "Expected an error for non-existent record");
      }
    });

    it("revoke_sbt burns token and marks record revoked", async () => {
      await program.methods
        .revokeSbt(SbtType.HumanCapital, 0)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
          authority: authority.publicKey,
          user: revokeRecipient.publicKey,
          sftMint: revokeMintKp.publicKey,
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
        await program.methods
          .verifySbt(revokeCollectionId, 0)
          .accounts({
            owner: revokeRecipient.publicKey,
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
          .revokeSbt(SbtType.HumanCapital, 0)
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.HumanCapital, program.programId),
            authority: authority.publicKey,
            user: revokeRecipient.publicKey,
            sftMint: revokeMintKp.publicKey,
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
      const sbtType = SbtType.HumanCapital;
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
      const configPda = deriveSbtConfig(SbtType.HumanCapital, program.programId);
      try {
        await program.methods
          .transferAuthority(SbtType.HumanCapital, impostor.publicKey)
          .accounts({ config: configPda, authority: impostor.publicKey })
          .signers([impostor])
          .rpc();
        assert.fail("Should have thrown");
      } catch (e: any) {
        assert.include(e.message, "Unauthorized");
      }
    });
  });

  describe("pause_program (sbt)", () => {
    const eventId = toId("test-event-001");
    const eventConfigPda = deriveEventConfig(eventId, program.programId);

    it("pauses and unpauses Event type", async () => {
      const configPda = deriveSbtConfig(SbtType.Event, program.programId);
      await program.methods
        .pauseProgram(SbtType.Event, true)
        .accounts({ sbtConfig: configPda, authority: authority.publicKey })
        .rpc();

      const paused = await program.account.sbtConfig.fetch(configPda);
      assert.isTrue(paused.paused);

      // Minting should fail while paused
      const r = Keypair.generate();
      await airdrop(provider.connection, r.publicKey);
      try {
        await program.methods
          .mintEventSbt("Org")
          .accounts({
            sbtConfig: configPda,
            eventConfig: eventConfigPda,
            sftMint: eventSftMint,
            authority: authority.publicKey,
            payer: authority.publicKey,
            recipient: r.publicKey,
            sbtRecord: deriveSbtRecord(eventId, 0, r.publicKey, program.programId),
            participationRecord: deriveParticipation(SbtType.Event, eventId, 0, r.publicKey, program.programId),
            tokenAccount: getToken2022ATA(eventSftMint, r.publicKey),
            token2022Program: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Expected ProgramPaused");
      } catch (e: any) {
        assert.ok(e.message.includes("ProgramPaused") || e.message.includes("2015"));
      }

      // Unpause
      await program.methods
        .pauseProgram(SbtType.Event, false)
        .accounts({ sbtConfig: configPda, authority: authority.publicKey })
        .rpc();
      const unpaused = await program.account.sbtConfig.fetch(configPda);
      assert.isFalse(unpaused.paused);
    });
  });

  describe("batch_mint_event", () => {
    const eventId = toId("test-event-001");
    const eventConfigPda = deriveEventConfig(eventId, program.programId);

    it("batch mints to 2 recipients via remaining_accounts", async () => {
      const r1 = Keypair.generate();
      const r2 = Keypair.generate();
      await Promise.all([
        airdrop(provider.connection, r1.publicKey),
        airdrop(provider.connection, r2.publicKey),
      ]);

      const ata1 = getToken2022ATA(eventSftMint, r1.publicKey);
      const ata2 = getToken2022ATA(eventSftMint, r2.publicKey);

      await program.methods
        .batchMintEvent()
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventConfigPda,
          sftMint: eventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: r1.publicKey, isSigner: false, isWritable: false },
          { pubkey: ata1, isSigner: false, isWritable: true },
          { pubkey: r2.publicKey, isSigner: false, isWritable: false },
          { pubkey: ata2, isSigner: false, isWritable: true },
        ])
        .rpc();

      const bal1 = await provider.connection.getTokenAccountBalance(ata1);
      const bal2 = await provider.connection.getTokenAccountBalance(ata2);
      assert.equal(bal1.value.uiAmount, 1);
      assert.equal(bal2.value.uiAmount, 1);
    });
  });

  describe("update_event metadata", () => {
    const eventId = toId("event-meta-upd-01");
    const eventPda = deriveEventConfig(eventId, program.programId);
    let metaEventSftMint: PublicKey;

    before(async () => {
      const sftMintKp = Keypair.generate();
      try {
        await program.methods
          .createEvent(eventId, "OldName", "OLD", "https://old.json")
          .accounts({
            sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
            eventConfig: eventPda,
            sftMint: sftMintKp.publicKey,
            authority: authority.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([sftMintKp])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }
      const cfg = await program.account.eventConfig.fetch(eventPda);
      metaEventSftMint = cfg.sftMint;
    });

    it("updates name, symbol, uri", async () => {
      await program.methods
        .updateEvent(true, "NewName", "NEW", "https://new.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventPda,
          sftMint: metaEventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
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
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventPda,
          sftMint: metaEventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      const cfg = await program.account.eventConfig.fetch(eventPda);
      assert.equal(cfg.name, "NewName"); // unchanged from previous test
      assert.isFalse(cfg.active);
      // restore
      await program.methods
        .updateEvent(true, null, null, null)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: eventPda,
          sftMint: metaEventSftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    });
  });

  describe("update_challenge metadata", () => {
    const cid = toId("challenge-meta-01");
    const cPda = deriveChallengeConfig(cid, program.programId);
    let metaAccMint: PublicKey;
    let metaMisMint: PublicKey;
    let metaComMint: PublicKey;

    before(async () => {
      const m1 = Keypair.generate(), m2 = Keypair.generate(), m3 = Keypair.generate();
      try {
        await program.methods
          .createChallenge(cid, "OldC", "OC", "https://a.json", "https://b.json", "https://c.json", 2)
          .accounts({
            sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
            sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
            challengeConfig: cPda,
            sftAcceptedMint: m1.publicKey,
            sftMissionMint: m2.publicKey,
            sftCompleteMint: m3.publicKey,
            authority: authority.publicKey,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([m1, m2, m3])
          .rpc();
      } catch (e: any) { if (!e.message?.includes("already in use")) throw e; }
      const cfg = await program.account.challengeConfig.fetch(cPda);
      metaAccMint = cfg.sftAcceptedMint;
      metaMisMint = cfg.sftMissionMint;
      metaComMint = cfg.sftCompleteMint;
    });

    it("updates name and URIs", async () => {
      await program.methods
        .updateChallenge(true, "NewC", "NC", "https://a2.json", "https://b2.json", "https://c2.json")
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: cPda,
          sftAcceptedMint: metaAccMint,
          sftMissionMint: metaMisMint,
          sftCompleteMint: metaComMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
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
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: cPda,
          sftAcceptedMint: metaAccMint,
          sftMissionMint: metaMisMint,
          sftCompleteMint: metaComMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      const cfg = await program.account.challengeConfig.fetch(cPda);
      assert.equal(cfg.name, "NewC"); // unchanged
      assert.isFalse(cfg.active);
      // restore
      await program.methods
        .updateChallenge(true, null, null, null, null, null)
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: cPda,
          sftAcceptedMint: metaAccMint,
          sftMissionMint: metaMisMint,
          sftCompleteMint: metaComMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    });
  });

  describe("close_event", () => {
    it("authority can close an inactive event", async () => {
      const eid = toId("close-event-001");
      const ePda = deriveEventConfig(eid, program.programId);
      const sftMintKp = Keypair.generate();
      await program.methods
        .createEvent(eid, "CloseMe", "CL", "https://close.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: ePda,
          sftMint: sftMintKp.publicKey,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sftMintKp])
        .rpc();

      const cfg = await program.account.eventConfig.fetch(ePda);
      // deactivate
      await program.methods
        .updateEvent(false, null, null, null)
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: ePda,
          sftMint: cfg.sftMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
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
      const sftMintKp = Keypair.generate();
      await program.methods
        .createEvent(eid, "Active", "ACT", "https://active.json")
        .accounts({
          sbtConfig: deriveSbtConfig(SbtType.Event, program.programId),
          eventConfig: ePda,
          sftMint: sftMintKp.publicKey,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sftMintKp])
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
      const m1 = Keypair.generate(), m2 = Keypair.generate(), m3 = Keypair.generate();
      await program.methods
        .createChallenge(cid, "CloseChallenge", "CC", "https://a.json", "https://b.json", "https://c.json", 2)
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: cPda,
          sftAcceptedMint: m1.publicKey,
          sftMissionMint: m2.publicKey,
          sftCompleteMint: m3.publicKey,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([m1, m2, m3])
        .rpc();

      const cfg = await program.account.challengeConfig.fetch(cPda);
      await program.methods
        .updateChallenge(false, null, null, null, null, null)
        .accounts({
          sbtConfigAccepted: deriveSbtConfig(SbtType.ChallengeAccepted, program.programId),
          sbtConfigMission: deriveSbtConfig(SbtType.ChallengeMission, program.programId),
          challengeConfig: cPda,
          sftAcceptedMint: cfg.sftAcceptedMint,
          sftMissionMint: cfg.sftMissionMint,
          sftCompleteMint: cfg.sftCompleteMint,
          authority: authority.publicKey,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
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
