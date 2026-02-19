# Contracts Overview

This module implements private supply/borrow/repay/withdraw routing with per-owner vault isolation.

## Core Contracts

1. `PrivateSupplyAdapter`
   Main contract that orchestrate all actions for a private wallet

- Supply privately: `onPrivateDeposit(token, amount, data)`
- Withdraw privately to a private address: `withdrawToRecipient(positionId, amount, withdrawAuthSecret, nextWithdrawAuthHash, recipient)`
- Borrow privately to a private address: `borrowToRecipient(positionId, debtToken, amount, authSecret, nextAuthHash, recipient)`
- Repay privately from adapter-funded balance: `repayFromPrivate(positionId, debtToken, amount, authSecret, nextAuthHash)`
- Stores positions keyed by `positionId` and owner index by `zkOwnerHash`.
- Access controlled by `privacyExecutor`.
- Borrow token allowlist is owner-managed via `setBorrowTokenAllowed`.

2. `VaultFactory`
   Factory that issue `UserVault` contract per each `zkOwnerHash`

- One vault per `zkOwnerHash`
- Adapter-only vault creation

3. `UserVault`
   The contract that supply and stores the aave token

- Supplies token to Aave pool
- Borrows token from Aave (variable rate mode)
- Repays token to Aave (variable rate mode)
- Withdraws from Aave directly to a recipient address

## Security Model (MVP)

1. `privacyExecutor` is the only caller allowed to trigger private deposit/withdraw callbacks. For Hinkal `actionPrivateWallet` stateless ops, this should be the chain Emporium address
2. Each position stores `withdrawAuthHash`
3. Withdraw requires matching secret and rotates secret on partial withdraw
4. Vault account identity is `zkOwnerHash`, not public EOA

## Required Env Keys

1. `RPC_URL`
2. `DEPLOYER_PRIVATE_KEY`
3. `PRIVATE_EMPORIUM` (set to Hinkal Emporium on your chain)
4. `SUPPLY_TOKEN`
5. `AAVE_POOL` (can be real contract or mock from `contracts/mocks/MockAavePool.sol`)
6. `BORROW_TOKEN` (allowlisted borrow asset, e.g. WETH on Arbitrum)
7. `VAULT_FACTORY` (after the deploy using `scripts/deploy-vault-factory.sh`)
8. `PRIVATE_SUPPLY_ADAPTER` (after deploy using `scripts/deploy-private-supply-adapter.sh`)
9. `BLOCKSCOUT_VERIFIER_URL` (optional, default: `https://arbitrum.blockscout.com/api/`)

## Scripts

1. Deploy factory:

```bash
bash scripts/deploy-vault-factory.sh
```

2. Deploy adapter:

```bash
bash scripts/deploy-private-supply-adapter.sh
```

3. Supply smoke:

```bash
bash scripts/smoke-test-supply-adapter.sh
```

4. Withdraw smoke:

```bash
bash scripts/smoke-test-withdraw-supply-adapter.sh
```

5. Borrow smoke:

```bash
bash scripts/smoke-test-borrow-supply-adapter.sh
```

6. Repay smoke:

```bash
bash scripts/smoke-test-repay-supply-adapter.sh
```

7. Sanity check:

```bash
bash scripts/sanity-check-mainnet-config.sh
```

8. Verify `VaultFactory` on Blockscout:

```bash
bash scripts/verify-vault-factory-blockscout.sh
```

9. Verify `PrivateSupplyAdapter` on Blockscout:

```bash
bash scripts/verify-private-supply-adapter-blockscout.sh
```

Verification notes:

- Both scripts read values from `.env`.
- `verify-private-supply-adapter-blockscout.sh` uses explicit constructor args from:
  - `PRIVATE_EMPORIUM`
  - `AAVE_POOL`
  - `SUPPLY_TOKEN`
  - `VAULT_FACTORY`
- To use another Blockscout instance:

```bash
BLOCKSCOUT_VERIFIER_URL="https://your-blockscout-domain/api/" \
bash scripts/verify-vault-factory-blockscout.sh

BLOCKSCOUT_VERIFIER_URL="https://your-blockscout-domain/api/" \
bash scripts/verify-private-supply-adapter-blockscout.sh
```

## Smoke test cleanup behavior

For these scripts:

- `scripts/smoke-test-supply-adapter.sh`
- `scripts/smoke-test-borrow-supply-adapter.sh`
- `scripts/smoke-test-repay-supply-adapter.sh`

default mode is cleanup-on-success:

- test assets are used during flow,
- debt is repaid where needed,
- collateral is withdrawn back to deployer wallet,
- executor is restored to original value.

Controls:

- `SMOKE_CLEANUP=true|false` (default `true`)
- `SMOKE_RESTORE_EXECUTOR=true|false` (default `true`)
- `SMOKE_WITHDRAW_SECRET_LABEL=...` (deterministic auth secret seed)
- If omitted, `SMOKE_WITHDRAW_SECRET_LABEL` is auto-generated per run.

If `SMOKE_CLEANUP=false`, keep `SMOKE_WITHDRAW_SECRET_LABEL` to recover funds manually later.

Recommended run sequence (no extra flags required):

```bash
bash scripts/smoke-test-supply-adapter.sh
bash scripts/smoke-test-borrow-supply-adapter.sh
bash scripts/smoke-test-repay-supply-adapter.sh
```
