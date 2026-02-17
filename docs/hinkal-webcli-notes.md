# Hinkal WebCLI Integration Notes

This document is a practical handoff for future development in this repository.

## 1. Current Product Surface

The active app surface is the browser WebCLI:

- `src/webcli/app.ts`
- `src/webcli/entry.ts`
- `src/privacy/hinkalManager.ts`

`src/servercli` is currently empty, so all current runtime behavior is in WebCLI.

## 2. High-Level Architecture

1. User signs with injected EOA wallet.
2. Hinkal session is initialized from mnemonic + signer.
3. Public USDC can be shielded/unshielded.
4. Private supply executes two Emporium ops:
   - transfer USDC to adapter
   - call adapter `onPrivateDeposit`
5. Adapter routes supply into vault/Aave position.
6. Private withdraw calls adapter `withdrawToRecipient` and returns output to private balance.

## 3. Address Model

Three addresses can differ:

1. EOA signer (wallet account)
2. Private address (derived from mnemonic, used for owner hash)
3. Hinkal sub-account (deterministic key used for action signing)

Do not treat these as interchangeable.

## 4. Commands and Behavior

Main commands:

1. `privacy-login`
2. `privacy-import <mnemonic>`
3. `approve-token <amount>`
4. `shield-token <amount>`
5. `unshield-token <amount> [recipient]`
6. `private-balance`
7. `private-supply <amount>`
8. `show-positions`
9. `private-withdraw <positionId> <amount|max>`

### private-supply

- Validates chain + adapter config.
- Checks private spendable balance.
- Pre-estimates Hinkal fee and enforces a reserve guard.
- Stores `withdrawAuthSecret` locally in session after position creation.

### private-withdraw

- Uses private destination flow (not public recipient):
  - adapter op recipient is Emporium
  - Hinkal `recipientData` is included for private credit
- Resolves `max` to exact on-chain position amount.
- Includes fallback retry with `amount - 1` for Aave rounding edge case.
- Rotates secret on partial withdraw; removes on full close.

## 5. Fee Model

Hinkal fee is runtime-estimated (`flatFee`) and not fixed.

WebCLI reserve policy:

- `reserve = flatFee + max(flatFee * bufferBps, minBuffer)`
- defaults:
  - `bufferBps = 2000` (20%)
  - `minBuffer = 0.002 USDC`

User-visible lines are printed before submit:

- `Fee estimate (supply): flatFee=... reserve=... required=...`
- `Fee estimate (withdraw): flatFee=... reserve=... requiredPrivateBalance=...`

## 6. Important Env Keys

Required:

1. `VITE_PRIVATE_RPC`
2. `VITE_PRIVATE_EMPORIUM`
3. `VITE_PRIVATE_SUPPLY_ADAPTER`
4. `VITE_SUPPLY_TOKEN`

Optional:

1. `VITE_PRIVATE_DEBUG`
2. `VITE_PRIVATE_TEST_MNEMONIC`
3. `VITE_PRIVATE_FEE_BUFFER_BPS`
4. `VITE_PRIVATE_FEE_BUFFER_MIN`

## 7. Storage

Browser session is encrypted in local storage via:

- `src/privacy/privacySession.ts`

Node-format helper exists in:

- `src/privacy/privacySessionNode.ts`

## 8. Typical Failure Modes

### "Insufficient funds"

Most common root cause: private spendable is below action amount plus fee reserve.

### Adapter executor mismatch

`adapter.privacyExecutor()` must match configured Emporium.

### Transfer Failed

Often allowance/token routing mismatch in adapter path; inspect preflight logs.

## 9. Validation Commands

Always run after behavior changes:

1. `bun run typecheck`
2. `bun run build:web`

## 10. Change Invariants

1. Do not edit `node_modules`.
2. Keep private-withdraw as private destination flow.
3. Preserve position secret lifecycle.
4. Keep fee reserve guard in preflight to avoid runtime dead ends.
