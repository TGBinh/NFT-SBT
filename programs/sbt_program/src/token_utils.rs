use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke, program::invoke_signed, system_instruction},
};
use anchor_spl::{
    associated_token::{create as create_ata, Create as CreateAta},
    token_2022::{
        self,
        spl_token_2022::{
            extension::{metadata_pointer::instruction as mp_ix, ExtensionType},
            instruction::{
                initialize_mint2, initialize_non_transferable_mint,
                initialize_permanent_delegate,
            },
            state::Mint as SplMintState,
        },
        Burn, FreezeAccount, MintTo, ThawAccount,
    },
};
use spl_token_metadata_interface::instruction::{initialize as init_metadata, update_field};
use spl_token_metadata_interface::state::Field;

/// Creates a shared SFT mint (NonTransferable + PermanentDelegate + MetadataPointer + TokenMetadata).
/// SbtConfig PDA is mint authority, freeze authority, and permanent delegate.
/// Mint authority is KEPT so future mint_sft_to_user calls can succeed.
pub fn create_sft_mint<'info>(
    mint: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    name: String,
    symbol: String,
    uri: String,
    token_2022_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();

    let base_ext = [
        ExtensionType::NonTransferable,
        ExtensionType::PermanentDelegate,
        ExtensionType::MetadataPointer,
    ];
    let base_size = ExtensionType::try_calculate_account_len::<SplMintState>(&base_ext)
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?;

    // Variable TokenMetadata TLV: 4 (type) + 4 (len) + 32 (update_authority) + 32 (mint)
    // + (4+name.len) + (4+symbol.len) + (4+uri.len) + 4 (additional_metadata vec) + 64 (buffer)
    let metadata_len = 4 + 4 + 32 + 32
        + (4 + name.len())
        + (4 + symbol.len())
        + (4 + uri.len())
        + 4 + 64;
    let mint_space = base_size + metadata_len;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);

    // 1: allocate mint account
    invoke(
        &system_instruction::create_account(
            payer.key,
            mint.key,
            rent_lamports,
            mint_space as u64,
            &token_2022_id,
        ),
        &[payer.clone(), mint.clone(), system_program.clone()],
    )?;

    // 2: MetadataPointer (must be before initialize_mint), self-referential
    invoke(
        &mp_ix::initialize(
            &token_2022_id,
            mint.key,
            Some(*sbt_config.key),
            Some(*mint.key),
        )
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 3: NonTransferable
    invoke(
        &initialize_non_transferable_mint(&token_2022_id, mint.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 4: PermanentDelegate = SbtConfig PDA
    invoke(
        &initialize_permanent_delegate(&token_2022_id, mint.key, sbt_config.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 5: initialize_mint2 — authority = SbtConfig PDA (kept for mint_to_user)
    invoke(
        &initialize_mint2(
            &token_2022_id,
            mint.key,
            sbt_config.key,
            Some(sbt_config.key),
            0,
        )
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // 6: initialize TokenMetadata — SbtConfig PDA signs as mint_authority
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];
    invoke_signed(
        &init_metadata(
            &token_2022_id,
            mint.key,
            sbt_config.key,
            mint.key,
            sbt_config.key,
            name,
            symbol,
            uri,
        ),
        &[mint.clone(), sbt_config.clone()],
        signer_seeds,
    )?;

    Ok(())
}

/// Mint 1 SFT token to user's ATA and freeze the ATA.
/// SbtConfig PDA signs as mint authority and freeze authority.
pub fn mint_sft_to_user<'info>(
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    token_2022_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    create_ata(CpiContext::new(
        associated_token_program.clone(),
        CreateAta {
            payer: payer.clone(),
            associated_token: token_account.clone(),
            authority: recipient.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_2022_program.clone(),
        },
    ))?;

    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_2022_program.clone(),
            MintTo {
                mint: mint.clone(),
                to: token_account.clone(),
                authority: sbt_config.clone(),
            },
            signer_seeds,
        ),
        1,
    )?;

    token_2022::freeze_account(CpiContext::new_with_signer(
        token_2022_program.clone(),
        FreezeAccount {
            account: token_account.clone(),
            mint: mint.clone(),
            authority: sbt_config.clone(),
        },
        signer_seeds,
    ))?;

    Ok(())
}

/// Revoke: thaw ATA then burn 1 token using PermanentDelegate.
pub fn revoke_sft_from_user<'info>(
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    token_2022_program: &AccountInfo<'info>,
) -> Result<()> {
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];

    token_2022::thaw_account(CpiContext::new_with_signer(
        token_2022_program.clone(),
        ThawAccount {
            account: token_account.clone(),
            mint: mint.clone(),
            authority: sbt_config.clone(),
        },
        signer_seeds,
    ))?;

    token_2022::burn(
        CpiContext::new_with_signer(
            token_2022_program.clone(),
            Burn {
                mint: mint.clone(),
                from: token_account.clone(),
                authority: sbt_config.clone(),
            },
            signer_seeds,
        ),
        1,
    )?;

    Ok(())
}

/// Update a single TokenMetadata field (name, symbol, or uri) on a shared SFT mint.
/// SbtConfig PDA signs as update authority.
pub fn update_sft_metadata_field<'info>(
    mint: &AccountInfo<'info>,
    sbt_config: &AccountInfo<'info>,
    sbt_type: u8,
    config_bump: u8,
    field: Field,
    value: String,
    token_2022_program: &AccountInfo<'info>,
) -> Result<()> {
    let pda_signer: &[&[u8]] = &[b"sbt_config", &[sbt_type], &[config_bump]];
    let signer_seeds: &[&[&[u8]]] = &[pda_signer];
    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();

    invoke_signed(
        &update_field(&token_2022_id, mint.key, sbt_config.key, field, value),
        &[mint.clone(), sbt_config.clone()],
        signer_seeds,
    )?;

    Ok(())
}

/// Legacy: unique SBT mint for HumanCapital (type=0).
/// Creates a new unique mint per user: NonTransferable + PermanentDelegate,
/// removes mint authority (supply locked at 1), freezes ATA, transfers freeze authority to PDA.
pub fn mint_sbt_token<'info>(
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    permanent_delegate: &AccountInfo<'info>,
    token_2022_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    _rent: &AccountInfo<'info>,
) -> Result<()> {
    use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
    use anchor_spl::token_2022::SetAuthority;

    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();
    let extension_types = [
        ExtensionType::NonTransferable,
        ExtensionType::PermanentDelegate,
    ];
    let mint_space =
        ExtensionType::try_calculate_account_len::<SplMintState>(&extension_types)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);

    invoke(
        &system_instruction::create_account(
            authority.key,
            mint.key,
            rent_lamports,
            mint_space as u64,
            &token_2022_id,
        ),
        &[authority.clone(), mint.clone(), system_program.clone()],
    )?;
    invoke(
        &initialize_non_transferable_mint(&token_2022_id, mint.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;
    invoke(
        &initialize_permanent_delegate(&token_2022_id, mint.key, permanent_delegate.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;
    invoke(
        &initialize_mint2(
            &token_2022_id,
            mint.key,
            authority.key,
            Some(authority.key),
            0,
        )
        .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;
    create_ata(CpiContext::new(
        associated_token_program.clone(),
        CreateAta {
            payer: authority.clone(),
            associated_token: token_account.clone(),
            authority: recipient.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_2022_program.clone(),
        },
    ))?;
    token_2022::mint_to(
        CpiContext::new(
            token_2022_program.clone(),
            MintTo {
                mint: mint.clone(),
                to: token_account.clone(),
                authority: authority.clone(),
            },
        ),
        1,
    )?;
    token_2022::set_authority(
        CpiContext::new(
            token_2022_program.clone(),
            SetAuthority {
                account_or_mint: mint.clone(),
                current_authority: authority.clone(),
            },
        ),
        AuthorityType::MintTokens,
        None,
    )?;
    token_2022::freeze_account(CpiContext::new(
        token_2022_program.clone(),
        FreezeAccount {
            account: token_account.clone(),
            mint: mint.clone(),
            authority: authority.clone(),
        },
    ))?;
    token_2022::set_authority(
        CpiContext::new(
            token_2022_program.clone(),
            SetAuthority {
                account_or_mint: mint.clone(),
                current_authority: authority.clone(),
            },
        ),
        AuthorityType::FreezeAccount,
        Some(*permanent_delegate.key),
    )?;
    Ok(())
}
