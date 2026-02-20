# Hinkal integration

The core privacy infrastructure that is used under the hood is provided by the [Hinkal protocol](https://hinkal.pro/)

## 1. High-Level Architecture

1. User signs with injected EOA wallet
2. Hinkal session is initialized from mnemonic + signer
3. Public USDC can be shielded/unshielded
4. Private supply executes two Emporium ops:
   - transfer USDC to adapter
   - call adapter `onPrivateDeposit`
5. Adapter routes supply into vault/Aave position
6. Private borrow calls adapter `borrowToRecipient` and credits borrowed WETH back to private balance
7. Private repay transfers WETH to adapter and calls `repayFromPrivate`
8. Private withdraw calls adapter `withdrawToRecipient` and returns output to private balance

## 2. Address Model

Three addresses can differ:

1. EOA signer (wallet account)
2. Private address (derived from mnemonic, used for owner hash)
3. Hinkal sub-account (deterministic key used for action signing)

Do not treat these as interchangeable

## 3. AAVE private supply + borrow

### Supply method

- Validates chain + adapter config.
- Checks private spendable balance
- Pre-estimates Hinkal fee and enforces a reserve guard
- Stores `withdrawAuthSecret` locally in session after position creation
- Prints backup secret in CLI output after position creation (sensitive)

### Withdraw method

- Uses private destination flow (not public recipient):
  - adapter op recipient is Emporium
  - Hinkal `recipientData` is included for private credit
- Resolves `max` to exact on-chain position amount
- Includes fallback retry with `amount - 1` for Aave rounding edge case
- Rotates secret on partial withdraw; removes on full close
- Prints rotated secret in CLI output after partial withdraw (sensitive)

### Borrow method

- Requires adapter borrow-token allowlist (`setBorrowTokenAllowed`)
- Uses same per-position auth secret model as withdraw
- Borrows with Aave variable rate mode (2)
- Routes borrowed WETH to Emporium and credits private balance
- Rotates secret after successful borrow
- Prints rotated secret in CLI output after borrow (sensitive)

### Repay method

- Builds two Emporium ops:
  - transfer WETH to adapter
  - call `repayFromPrivate`
- Uses same per-position auth secret model
- Pays Hinkal fee in USDC (same reserve guard policy)
- Rotates secret after successful repay
- Prints rotated secret in CLI output after repay (sensitive)

## 4. Fee model

Hinkal fee is runtime-estimated (`flatFee`) and not fixed

WebCLI reserve policy:

- `reserve = flatFee + max(flatFee * bufferBps, minBuffer)`
- defaults:
  - `bufferBps = 2000` (20%)
  - `minBuffer = 0.002 USDC`

User-visible lines are printed before submit:

- `Fee estimate (supply): flatFee=... reserve=... required=...`
- `Fee estimate (withdraw): flatFee=... reserve=... requiredPrivateBalance=...`
- `Fee estimate (borrow): flatFee=... reserve=... requiredPrivateUSDC=...`
- `Fee estimate (repay): flatFee=... reserve=... requiredPrivateUSDC=...`

## 5. Storage

Browser session is encrypted in local storage via:

- `src/privacy/privacySession.ts`
- CLI output also includes `WithdrawAuth backup` lines by design today.
- Anyone with the latest secret for a position can execute auth-protected private actions for that position.
- Treat these secrets like private keys and keep logs/screenshots private.

## 6. Typical failure modes

### "Insufficient funds"

Most common root cause: private spendable is below action amount plus fee reserve

### Adapter executor mismatch

`adapter.privacyExecutor()` must match configured Emporium

### Transfer Failed

Often allowance/token routing mismatch in adapter path; inspect preflight logs

### Borrow token not enabled

Adapter must allowlist configured WETH via `setBorrowTokenAllowed`.
