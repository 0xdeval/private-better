# Private Supply Contracts (Junior-Friendly Guide)

This folder contains the smart-contract side of the private supply MVP:

1. User holds private balance in Railgun.
2. Railgun unshields to adapter.
3. Adapter supplies into Aave through a user vault.
4. User can later withdraw and shield back to private balance.

## Table Of Contents

1. [Mental Model](#1-mental-model)
2. [Security Model (Important)](#2-security-model-important)
3. [Contracts and Their Job](#3-contracts-and-their-job)
4. [Main Contracts vs Test Contracts](#31-main-contracts-vs-test-contracts)
5. [End-to-End Behavior](#4-end-to-end-behavior)
6. [Required .env Keys](#5-required-env-keys)
7. [Reproduce Everything](#6-reproduce-everything)
8. [Common Errors and Fixes](#7-common-errors-and-fixes)

## 1) Mental Model

Think about this system as three layers:

1. Entry layer: `PrivateSupplyAdapter` receives Railgun callback actions.
2. Isolation layer: `VaultFactory` creates one `UserVault` per private owner hash.
3. Strategy layer: `UserVault` talks to Aave Pool.

Why this design:

1. A vault is shared per `zkOwnerHash`, so one private user has one isolated strategy account.
2. Position bookkeeping stays inside adapter (`positionId -> vault/token/amount/auth hash`).
3. Public wallet and private identity are not linked on-chain.

## 2) Security Model (Important)

1. Withdraw guard: position secret proof
- On supply, each position stores `withdrawAuthHash = keccak256(secret)`.
- On withdraw, caller must provide the matching `secret`.
- For partial withdraws, a new auth hash is written (`nextWithdrawAuthHash`) to prevent replay.

2. Withdraw path: Railgun-only
- `withdrawAndShield` is restricted with `onlyRailgunCallback`.
- This is why withdraw is no longer `onlyOwner`: user-owned private flow should control withdraw, not admin key.
- Shield destination is always the original position owner hash.

3. Safe secret rotation flow
- Keep current secret encrypted locally.
- Partial withdraw: generate new secret, pass only new hash on-chain.
- After success, replace old secret locally.
- Full withdraw: set next hash to zero and delete local secret.

## 3) Contracts and Their Job

1. `contracts/PrivateSupplyAdapter.sol`
- Main orchestrator.
- `onRailgunUnshield(token, amount, data)`:
  - validates callback sender,
  - decodes `SupplyRequest { zkOwnerHash, withdrawAuthHash }`,
  - gets user vault from factory,
  - transfers token to vault,
  - calls vault supply,
  - stores position and indexes it by owner hash.
- `withdrawAndShield(positionId, amount, withdrawAuthSecret, nextWithdrawAuthHash)`:
  - validates callback sender,
  - validates secret proof,
  - withdraws from vault/Aave,
  - updates position amount and auth hash,
  - shields back to position owner hash.

2. `contracts/VaultFactory.sol`
- Mapping: `zkOwnerHash => vault`.
- `getOrCreateVault` creates vault only once per private owner hash.

3. `contracts/UserVault.sol`
- Callable only by adapter.
- `supply(...)` approves Aave Pool and calls `Pool.supply`.
- `withdrawToAdapter(...)` calls `Pool.withdraw` back to adapter.

4. `contracts/interfaces/IAavePool.sol`
- Minimal Aave interface used by vault.

5. `contracts/mocks/MockAavePool.sol`
- Deterministic local/test behavior for supply/withdraw accounting.

6. `contracts/mocks/MockRailgun.sol`
- Mock callback sender and mock shield endpoint.

7. `contracts/mocks/MockUSDC.sol`
- 6-decimal test token for local/mock flow.

8. `contracts/test/PrivateSupplyAdapter.t.sol`
- Core unit tests:
  - supply stores auth hash and owner index,
  - withdraw with correct secret works,
  - wrong secret fails,
  - non-callback withdraw fails,
  - partial withdraw rotates secret.

## 3.1) Main Contracts vs Test Contracts

Main contracts used in real flow:
1. `contracts/PrivateSupplyAdapter.sol`
2. `contracts/VaultFactory.sol`
3. `contracts/UserVault.sol`
4. `contracts/interfaces/IAavePool.sol`

Test/support contracts:
1. `contracts/mocks/MockAavePool.sol`
2. `contracts/mocks/MockRailgun.sol`
3. `contracts/mocks/MockUSDC.sol`

## 4) End-to-End Behavior

### Supply path

1. Adapter receives `onRailgunUnshield`.
2. Adapter gets/creates vault from factory.
3. Adapter sends token to vault.
4. Vault supplies to Aave.
5. Adapter creates position with owner hash + withdraw auth hash.

### Withdraw path

1. Railgun callback calls `withdrawAndShield(positionId, amount, withdrawSecret, nextWithdrawAuthHash)`.
2. Adapter checks `keccak256(withdrawSecret)` equals stored hash.
3. Vault withdraws from Aave back to adapter.
4. Adapter shields withdrawn token back to original `zkOwnerHash`.
5. Adapter reduces position amount and rotates/clears auth hash.

## 5) Required .env Keys

```env
RPC_URL=
DEPLOYER_PRIVATE_KEY=

SUPPLY_TOKEN=
AAVE_POOL=

PRIVATE_SUPPLY_ADAPTER=
VAULT_FACTORY=

RAILGUN_CALLBACK_SENDER=
RAILGUN_SHIELD=

MOCK_AAVE_POOL=
MOCK_RAILGUN=
```

Notes:

1. Scripts support legacy `AMOY_*` keys as fallback.
2. `SUPPLY_TOKEN` must be an active reserve in selected `AAVE_POOL`.
3. Final Arbitrum One policy uses native USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.

## 6) Reproduce Everything

### A) Compile

```bash
forge build
```

### B) Deploy contracts

```bash
bash scripts/deploy-vault-factory.sh
bash scripts/deploy-private-supply-adapter.sh
```

Optional mocks for smoke mode:

```bash
bash scripts/deploy-mock-aave-pool.sh
bash scripts/deploy-mock-railgun.sh
```

### C) Configure `.env` for the mode you want

Real mode (Aave + real Railgun addresses):
1. `AAVE_POOL` = real pool
2. `SUPPLY_TOKEN` = reserve token for that pool
3. `RAILGUN_CALLBACK_SENDER` = real relay adapt callback sender
4. `RAILGUN_SHIELD` = real railgun shield/proxy
5. `VAULT_FACTORY` and `PRIVATE_SUPPLY_ADAPTER` = your deployed addresses

Smoke mode (controlled withdraw-shield checks):
1. keep real `AAVE_POOL` / `SUPPLY_TOKEN` if you want real supply
2. set `MOCK_RAILGUN` to your mock railgun address
3. run withdraw script with `SMOKE_SET_SHIELD_TO_MOCK=true`

### D) Smoke test supply

```bash
SMOKE_STAKE_AMOUNT=1000000 bash scripts/smoke-test-supply-adapter.sh
```

Success:

1. `onRailgunUnshield` succeeds.
2. Position is created.
3. Vault address is printed.

### E) Smoke test withdraw + shield

```bash
SMOKE_STAKE_AMOUNT=1000000 \
SMOKE_WITHDRAW_AMOUNT=max \
SMOKE_SET_SHIELD_TO_MOCK=true \
bash scripts/smoke-test-withdraw-supply-adapter.sh
```

Success:

1. `withdrawAndShield` succeeds.
2. Position amount becomes `0` for full withdraw.
3. If mock shield is used, mock railgun token balance increases.

### F) Read-only mainnet sanity check

```bash
bash scripts/sanity-check-mainnet-config.sh
```

This validates adapter/env alignment and confirms selected token is an active Aave reserve.

## 7) Common Errors and Fixes

1. `execution reverted: 51`
- Meaning: Aave reserve supply cap issue.
- Fix: choose another reserve or another market with headroom.

2. `adapter supplyToken() does not match SUPPLY_TOKEN`
- Meaning: `.env` token and adapter config differ.
- Fix: call `setSupplyToken` on adapter.

3. `onRailgunUnshield` access control revert
- Meaning: caller is not current `railgunCallbackSender`.
- Fix: for smoke tests, temporarily set callback sender to deployer.

4. `invalid withdraw auth`
- Meaning: wrong/old secret provided.
- Fix: use current secret and keep local secret rotation logic in sync.
