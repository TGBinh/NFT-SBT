use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke, system_instruction},
};
use anchor_spl::{
    associated_token::{create as create_ata, Create as CreateAta},
    token_2022::{
        self,
        spl_token_2022::{
            extension::ExtensionType,
            instruction::{
                initialize_mint2, initialize_non_transferable_mint,
                initialize_permanent_delegate, AuthorityType,
            },
            state::Mint as SplMintState,
        },
        FreezeAccount, MintTo, SetAuthority,
    },
};

/// Mint a Token-2022 SBT with NonTransferable + PermanentDelegate extensions.
/// `permanent_delegate` must be the config PDA key that will sign future revocations.
/// Returns nothing; errors propagate to caller.
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
    let token_2022_id = anchor_spl::token_2022::spl_token_2022::id();

    let extension_types = [
        ExtensionType::NonTransferable,
        ExtensionType::PermanentDelegate,
    ];
    let mint_space =
        ExtensionType::try_calculate_account_len::<SplMintState>(&extension_types)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);

    // Step 1: allocate mint account
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

    // Step 2: NonTransferable extension
    invoke(
        &initialize_non_transferable_mint(&token_2022_id, mint.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // Step 3: PermanentDelegate extension (config PDA as delegate)
    invoke(
        &initialize_permanent_delegate(&token_2022_id, mint.key, permanent_delegate.key)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // Step 4: Initialize mint (decimals = 0)
    invoke(
        &initialize_mint2(&token_2022_id, mint.key, authority.key, Some(authority.key), 0)
            .map_err(|_| error!(crate::errors::SbtError::ExtensionError))?,
        &[mint.clone()],
    )?;

    // Step 5: Create ATA for recipient
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

    // Step 6: Mint 1 token
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

    // Step 7: Remove mint authority (supply locked at 1)
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

    // Step 8: Freeze recipient ATA
    token_2022::freeze_account(CpiContext::new(
        token_2022_program.clone(),
        FreezeAccount {
            account: token_account.clone(),
            mint: mint.clone(),
            authority: authority.clone(),
        },
    ))?;

    // Step 9: Transfer freeze authority to config PDA
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
