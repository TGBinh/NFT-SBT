import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
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
import { assert, expect } from "chai";

// =============================================================================
// CONSTANTS
// =============================================================================

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const CONFIG_SEED = Buffer.from("nft_config");

// =============================================================================
// HELPERS
// =============================================================================

function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

function deriveMetadataPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
}

function deriveMasterEditionPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    METADATA_PROGRAM_ID
  );
}

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  sol: number
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature: sig,
    ...latestBlockhash,
  });
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe("nft_program", () => {
  // ----------------------------
  // Setup provider & program
  // ----------------------------
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NftProgram as Program<NftProgram>;
  const connection = provider.connection;

  // ----------------------------
  // Wallets
  // ----------------------------
  const authority = (provider.wallet as anchor.Wallet).payer; // admin
  const recipient = Keypair.generate();                        // user nhận NFT
  const unauthorizedUser = Keypair.generate();                 // user không có quyền

  // ----------------------------
  // Shared state across tests
  // ----------------------------
  let configPda: PublicKey;
  let mintKeypair: Keypair;
  let recipientTokenAccount: PublicKey;
  let metadataPda: PublicKey;
  let masterEditionPda: PublicKey;

  // =============================================================================
  // BEFORE ALL — Airdrop & derive PDAs
  // =============================================================================

  before(async () => {
    // Derive config PDA
    [configPda] = deriveConfigPda(program.programId);

    // Airdrop to wallets that will need SOL
    await airdrop(connection, recipient.publicKey, 2);
    await airdrop(connection, unauthorizedUser.publicKey, 2);

    console.log("Authority:", authority.publicKey.toBase58());
    console.log("Recipient:", recipient.publicKey.toBase58());
    console.log("Config PDA:", configPda.toBase58());
  });

  // =============================================================================
  // TEST 1 — Initialize Config
  // =============================================================================

  describe("initialize_config", () => {
    it("✅ Initializes config PDA successfully", async () => {
      await program.methods
        .initializeConfig()
        .accounts({
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      // Verify on-chain state
      const configAccount = await program.account.nftConfig.fetch(configPda);

      assert.ok(
        configAccount.authority.equals(authority.publicKey),
        "Authority mismatch"
      );
      assert.equal(
        configAccount.nftCount.toNumber(),
        0,
        "nft_count should start at 0"
      );
      console.log("  Config initialized. Authority:", configAccount.authority.toBase58());
    });

    it("❌ Fails if config already initialized (account already exists)", async () => {
      try {
        await program.methods
          .initializeConfig()
          .accounts({
            authority: authority.publicKey,
          })
          .signers([authority])
          .rpc();

        assert.fail("Should have thrown — config already exists");
      } catch (err: any) {
        // Anchor throws when trying to re-init an existing account
        assert.ok(
          err.message.includes("already in use") ||
          err.logs?.some((l: string) => l.includes("already in use")),
          "Expected account-already-in-use error"
        );
        console.log("  Correctly rejected duplicate init");
      }
    });
  });

  // =============================================================================
  // TEST 2 — Mint NFT
  // =============================================================================

  describe("mint_nft", () => {
    before(async () => {
      // Generate a fresh mint keypair for each describe block
      mintKeypair = Keypair.generate();

      // Derive PDAs based on mint
      [metadataPda] = deriveMetadataPda(mintKeypair.publicKey);
      [masterEditionPda] = deriveMasterEditionPda(mintKeypair.publicKey);

      // Derive ATA for recipient
      recipientTokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        recipient.publicKey
      );

      console.log("  Mint:", mintKeypair.publicKey.toBase58());
      console.log("  Metadata PDA:", metadataPda.toBase58());
      console.log("  Master Edition PDA:", masterEditionPda.toBase58());
      console.log("  Recipient ATA:", recipientTokenAccount.toBase58());
    });

    it("✅ Mints NFT to recipient successfully", async () => {
      const name = "Test NFT";
      const symbol = "TNFT";
      const uri = "https://example.com/nft-metadata.json";
      const royalty = 500; // 5%

      await program.methods
        .mintNft(name, symbol, uri, royalty)
        .accounts({
          authority: authority.publicKey,
          payer: authority.publicKey,
          mint: mintKeypair.publicKey,
          recipient: recipient.publicKey,
        })
        .signers([authority, mintKeypair])
        .rpc();

      // Verify: recipient ATA holds exactly 1 token
      const tokenAccountInfo = await getAccount(
        connection,
        recipientTokenAccount
      );
      assert.equal(
        tokenAccountInfo.amount.toString(),
        "1",
        "Recipient should hold 1 NFT"
      );
      assert.ok(
        tokenAccountInfo.mint.equals(mintKeypair.publicKey),
        "Token account mint mismatch"
      );

      // Verify: nft_count incremented
      const configAccount = await program.account.nftConfig.fetch(configPda);
      assert.equal(
        configAccount.nftCount.toNumber(),
        1,
        "nft_count should be 1"
      );

      console.log("  NFT minted. nft_count:", configAccount.nftCount.toNumber());
    });

    // -----------------------------------------------------------------------
    // Royalty validation
    // -----------------------------------------------------------------------

    it("❌ Fails with royalty > 10000 (InvalidRoyalty)", async () => {
      const badMint = Keypair.generate();
      const [badMetadata] = deriveMetadataPda(badMint.publicKey);
      const [badEdition] = deriveMasterEditionPda(badMint.publicKey);
      const badAta = await getAssociatedTokenAddress(
        badMint.publicKey,
        recipient.publicKey
      );

      try {
        await program.methods
          .mintNft("Bad NFT", "BAD", "https://example.com/bad.json", 10001)
          .accounts({
            authority: authority.publicKey,
            payer: authority.publicKey,
            mint: badMint.publicKey,
            recipient: recipient.publicKey,
          })
          .signers([authority, badMint])
          .rpc();

        assert.fail("Should have thrown InvalidRoyalty");
      } catch (err: any) {
        assert.include(
          err.message,
          "InvalidRoyalty",
          "Expected InvalidRoyalty error"
        );
        console.log("  Correctly rejected royalty > 10000");
      }
    });

    it("❌ Fails with name > 32 characters (NameTooLong)", async () => {
      const badMint = Keypair.generate();
      const [badMetadata] = deriveMetadataPda(badMint.publicKey);
      const [badEdition] = deriveMasterEditionPda(badMint.publicKey);
      const badAta = await getAssociatedTokenAddress(
        badMint.publicKey,
        recipient.publicKey
      );

      try {
        await program.methods
          .mintNft(
            "This name is definitely way too long!!!",
            "SYM",
            "https://example.com/x.json",
            500
          )
          .accounts({
            authority: authority.publicKey,
            payer: authority.publicKey,
            mint: badMint.publicKey,
            recipient: recipient.publicKey,
          })
          .signers([authority, badMint])
          .rpc();

        assert.fail("Should have thrown NameTooLong");
      } catch (err: any) {
        assert.include(err.message, "NameTooLong", "Expected NameTooLong error");
        console.log("  Correctly rejected name > 32 chars");
      }
    });

    it("❌ Fails when unauthorized user tries to mint (Unauthorized)", async () => {
      const badMint = Keypair.generate();
      const [badMetadata] = deriveMetadataPda(badMint.publicKey);
      const [badEdition] = deriveMasterEditionPda(badMint.publicKey);
      const badAta = await getAssociatedTokenAddress(
        badMint.publicKey,
        recipient.publicKey
      );

      try {
        await program.methods
          .mintNft(
            "Unauthorized NFT",
            "UNFT",
            "https://example.com/u.json",
            500
          )
          .accounts({
            authority: authority.publicKey,
            payer: authority.publicKey,
            mint: badMint.publicKey,
            recipient: recipient.publicKey,
          })
          .signers([unauthorizedUser, badMint])
          .rpc();

        assert.fail("Should have thrown Unauthorized");
      } catch (err: any) {
        assert.include(
          err.message,
          "Unauthorized",
          "Expected Unauthorized error"
        );
        console.log("  Correctly rejected unauthorized mint");
      }
    });
  });

  // =============================================================================
  // TEST 3 — Verify Metadata On-chain
  // =============================================================================

  describe("metadata verification", () => {
    it("✅ Metadata account exists on-chain after mint", async () => {
      const metadataAccountInfo = await connection.getAccountInfo(metadataPda);

      assert.ok(metadataAccountInfo !== null, "Metadata account should exist");
      assert.ok(
        metadataAccountInfo.owner.equals(METADATA_PROGRAM_ID),
        "Metadata account should be owned by Metaplex program"
      );
      assert.ok(
        metadataAccountInfo.data.length > 0,
        "Metadata account should have data"
      );

      console.log(
        "  Metadata account size:",
        metadataAccountInfo.data.length,
        "bytes"
      );
    });

    it("✅ Master Edition account exists on-chain after mint", async () => {
      const masterEditionInfo = await connection.getAccountInfo(masterEditionPda);

      assert.ok(
        masterEditionInfo !== null,
        "Master Edition account should exist"
      );
      assert.ok(
        masterEditionInfo.owner.equals(METADATA_PROGRAM_ID),
        "Master Edition should be owned by Metaplex program"
      );

      console.log(
        "  Master Edition account size:",
        masterEditionInfo.data.length,
        "bytes"
      );
    });

    it("❌ Fails to mint NFT with same mint twice (MetadataAlreadyExists)", async () => {
      // Dùng lại mintKeypair cũ — metadata đã tồn tại → constraint data_is_empty() fail
      try {
        await program.methods
          .mintNft("Duplicate", "DUP", "https://example.com/dup.json", 100)
          .accounts({
            authority: authority.publicKey,
            payer: authority.publicKey,
            mint: mintKeypair.publicKey,
            recipient: recipient.publicKey,
          })
          .signers([authority, mintKeypair])
          .rpc();

        assert.fail("Should have thrown MetadataAlreadyExists");
      } catch (err: any) {
        assert.ok(
          err.message.includes("MetadataAlreadyExists") ||
          err.message.includes("already in use"),
          "Expected MetadataAlreadyExists or account-already-in-use error"
        );
        console.log("  Correctly rejected duplicate mint");
      }
    });
  });

  // =============================================================================
  // TEST 4 — Transfer NFT
  // =============================================================================

  describe("transfer_nft", () => {
    let transferTarget: Keypair;
    let targetTokenAccount: PublicKey;

    before(async () => {
      transferTarget = Keypair.generate();
      await airdrop(connection, transferTarget.publicKey, 1);

      targetTokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        transferTarget.publicKey
      );

      console.log("  Transfer target:", transferTarget.publicKey.toBase58());
    });

    it("✅ Transfers NFT from recipient to transferTarget", async () => {
      await program.methods
        .transferNft()
        .accounts({
          owner: recipient.publicKey,
          recipient: transferTarget.publicKey,
          mint: mintKeypair.publicKey,
        })
        .signers([recipient])
        .rpc();

      // Verify: from account now has 0
      const fromAccount = await getAccount(connection, recipientTokenAccount);
      assert.equal(fromAccount.amount.toString(), "0", "Sender should have 0");

      // Verify: to account now has 1
      const toAccount = await getAccount(connection, targetTokenAccount);
      assert.equal(toAccount.amount.toString(), "1", "Receiver should have 1");

      console.log("  Transfer successful");
    });

    it("❌ Fails when sender does not own the NFT (TokenNotOwned)", async () => {
      // recipient không còn NFT → from_token_account.amount == 0
      try {
        await program.methods
          .transferNft()
          .accounts({
            owner: recipient.publicKey,
            recipient: transferTarget.publicKey,
            mint: mintKeypair.publicKey,
          })
          .signers([recipient])
          .rpc();

        assert.fail("Should have thrown TokenNotOwned");
      } catch (err: any) {
        assert.include(
          err.message,
          "TokenNotOwned",
          "Expected TokenNotOwned error"
        );
        console.log("  Correctly rejected transfer from empty account");
      }
    });
  });

  // =============================================================================
  // TEST 5 — Burn NFT
  // =============================================================================

  describe("burn_nft", () => {
    let burnMint: Keypair;
    let burnRecipient: Keypair;
    let burnTokenAccount: PublicKey;

    before(async () => {
      // Mint một NFT mới để test burn
      burnMint = Keypair.generate();
      burnRecipient = Keypair.generate();
      await airdrop(connection, burnRecipient.publicKey, 2);

      const [burnMetadata] = deriveMetadataPda(burnMint.publicKey);
      const [burnEdition] = deriveMasterEditionPda(burnMint.publicKey);

      burnTokenAccount = await getAssociatedTokenAddress(
        burnMint.publicKey,
        burnRecipient.publicKey
      );

      // Mint NFT cho burnRecipient
      await program.methods
        .mintNft(
          "Burn Test NFT",
          "BURN",
          "https://example.com/burn.json",
          100
        )
        .accounts({
          authority: authority.publicKey,
          payer: authority.publicKey,
          mint: burnMint.publicKey,
          recipient: burnRecipient.publicKey,
        })
        .signers([authority, burnMint])
        .rpc();

      console.log("  Burn test NFT minted:", burnMint.publicKey.toBase58());
    });

    it("✅ Burns NFT successfully", async () => {
      await program.methods
        .burnNft()
        .accounts({
          owner: burnRecipient.publicKey,
          mint: burnMint.publicKey,
        })
        .signers([burnRecipient])
        .rpc();

      // Verify: token account amount = 0
      const tokenAccountInfo = await getAccount(connection, burnTokenAccount);
      assert.equal(
        tokenAccountInfo.amount.toString(),
        "0",
        "Token account should be empty after burn"
      );

      console.log("  NFT burned successfully");
    });

    it("❌ Fails to burn when account is already empty (TokenNotOwned)", async () => {
      try {
        await program.methods
          .burnNft()
          .accounts({
            owner: burnRecipient.publicKey,
            mint: burnMint.publicKey,
          })
          .signers([burnRecipient])
          .rpc();

        assert.fail("Should have thrown TokenNotOwned");
      } catch (err: any) {
        assert.include(
          err.message,
          "TokenNotOwned",
          "Expected TokenNotOwned error"
        );
        console.log("  Correctly rejected burn of empty account");
      }
    });
  });

  // =============================================================================
  // TEST 6 — Update Authority
  // =============================================================================

  describe("update_authority", () => {
    const newAuthority = Keypair.generate();

    it("✅ Updates authority successfully", async () => {
      await program.methods
        .updateAuthority(newAuthority.publicKey)
        .accounts({
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const configAccount = await program.account.nftConfig.fetch(configPda);
      assert.ok(
        configAccount.authority.equals(newAuthority.publicKey),
        "Authority should be updated"
      );
      console.log("  Authority updated to:", newAuthority.publicKey.toBase58());

      await airdrop(connection, newAuthority.publicKey, 1);
      await program.methods
        .updateAuthority(authority.publicKey)
        .accounts({
          authority: newAuthority.publicKey,
        })
        .signers([newAuthority])
        .rpc();

      console.log("  Authority restored to original");
    });

    it("❌ Fails when unauthorized user tries to update authority", async () => {
      try {
        await program.methods
          .updateAuthority(unauthorizedUser.publicKey)
          .accounts({
            authority: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();

        assert.fail("Should have thrown Unauthorized");
      } catch (err: any) {
        assert.include(
          err.message,
          "Unauthorized",
          "Expected Unauthorized error"
        );
        console.log("  Correctly rejected unauthorized authority update");
      }
    });
  });
});