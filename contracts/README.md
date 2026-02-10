# PrivateBet Contracts (Phase 2)

This folder contains the Phase 2 smart-contract layer for the hackathon MVP.

Goal:

- Validate the atomic private betting flow with mocks on Polygon Amoy before integrating real Azuro and real Railgun cross-contract calls.

## User-Friendly Overview

Short version:

1. `PrivateBetAdapter` is the real custom contract for this project.
2. `MockAzuro` is a temporary fake betting protocol used only for testing.
3. `MockRailgun` is a temporary fake Railgun endpoint used only for testing.

What happens in the tested flow:

1. `MockRailgun` sends USDC to `PrivateBetAdapter` and triggers callback.
2. `PrivateBetAdapter` places a bet in `MockAzuro`.
3. Adapter stores ownership as `zkOwnerHash` (private identity mapping), not public wallet identity.
4. When bet is settled as win, adapter claims payout.
5. Adapter sends payout back to Railgun shield target.

What will be replaced later:

1. `MockRailgun` -> real Railgun/RelayAdapt integration.
2. `MockAzuro` -> real Azuro integration (via adapter/wrapper).

What remains as project core:

1. `PrivateBetAdapter` stays as the main product contract logic.

## What These Contracts Do

1. `PrivateBetAdapter.sol`

- Main adapter contract for the private bet flow.
- Accepts callback-style unshield input (`onRailgunUnshield`), places a bet, and stores ownership mapping by `zkOwnerHash`.
- On `redeemWin`, claims payout from Azuro and calls `shield(...)` back to Railgun target.

2. `mocks/MockAzuro.sol`

- Simplified Azuro-like contract.
- Supports `placeBet`, `settleBet`, `isClaimable`, `claim`, `seedLiquidity`.

3. `mocks/MockRailgun.sol`

- Simplified Railgun-like contract for testing.
- Supports `unshieldToAdapter` and `shield`.

4. `mocks/MockUSDC.sol`

- Minimal ERC20 (6 decimals) for local/mock test flows.

5. `interfaces/*`

- `IAzuro`, `IRailgunShield`, `IPrivateBetAdapter`, `IERC20`.

6. `test/PrivateBetAdapter.t.sol`

- Foundry test suite for Phase 2 behavior.

## Current Status

Implemented and validated:

1. Local unit/integration tests via Foundry pass.
2. On-chain mock smoke test on Amoy passes.
3. Deployed contracts can execute:

- `onRailgunUnshield -> placeBet -> settle -> redeemWin -> shield`

Not yet implemented:

1. Real Azuro wrapper (`AzuroAdapter`) over production Azuro contracts.
2. Real Railgun cross-contract unshield transaction from frontend.
3. Real Railgun shield request struct integration (current on-chain smoke uses `MockRailgun`).

## Prerequisites

1. Foundry installed (`forge`, `cast`).
2. Bun installed (used by smoke script to encode payload).
3. `.env` with at least:

```env
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
DEPLOYER_PRIVATE_KEY=0x...
AMOY_USDC=0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
```

## Quick Start (Step by Step)

Run from project root.

### Step 1: Run local tests

```bash
forge test -vv
```

Expected:

- 3 tests passing in `contracts/test/PrivateBetAdapter.t.sol`

### Step 2: Deploy `MockAzuro` to Amoy

```bash
bash scripts/deploy-mock-azuro.sh
```

Copy output:

- `AMOY_AZURO_ADAPTER=0x...` into `.env`

### Step 3: Deploy `MockRailgun` to Amoy

```bash
bash scripts/deploy-mock-railgun.sh
```

Copy output:

- `AMOY_MOCK_RAILGUN=0x...` into `.env`

### Step 4: Deploy `PrivateBetAdapter` to Amoy

Before running, make sure `.env` contains:

```env
AMOY_RAILGUN_CALLBACK_SENDER=0x...
AMOY_RAILGUN_SHIELD=0x...
AMOY_AZURO_ADAPTER=0x...
AMOY_USDC=0x...
```

Deploy:

```bash
bash scripts/deploy-private-bet-adapter.sh
```

Copy output:

- `AMOY_PRIVATE_BET_ADAPTER=0x...` into `.env`

### Step 5: Configure adapter for smoke mode

For manual smoke testing, callback sender should be your deployer EOA and shield target should be `MockRailgun`.

```bash
set -a; source .env; set +a

cast send "$AMOY_PRIVATE_BET_ADAPTER" "setRailgunCallbackSender(address)" "$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")" \
  --rpc-url "$AMOY_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

cast send "$AMOY_PRIVATE_BET_ADAPTER" "setRailgunShield(address)" "$AMOY_MOCK_RAILGUN" \
  --rpc-url "$AMOY_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
```

### Step 6: Run on-chain smoke test

```bash
SMOKE_STAKE_AMOUNT=1000000 SMOKE_PAYOUT_AMOUNT=1000000 bash scripts/smoke-test-adapter.sh
```

`1000000` means `1.0` USDC (6 decimals).

Expected end state:

1. Script prints `Smoke test completed.`
2. Position for bet token id shows `claimed = true`.

## Scripts Reference

1. `scripts/deploy-mock-azuro.sh`

- Deploys `MockAzuro`.
- Prints `AMOY_AZURO_ADAPTER=...`.

2. `scripts/deploy-mock-railgun.sh`

- Deploys `MockRailgun`.
- Prints `AMOY_MOCK_RAILGUN=...`.

3. `scripts/deploy-private-bet-adapter.sh`

- Deploys `PrivateBetAdapter` with constructor args from `.env`.
- Prints `AMOY_PRIVATE_BET_ADAPTER=...`.

4. `scripts/smoke-test-adapter.sh`

- Executes end-to-end on-chain mock validation.
- Includes pre-checks and optional config restore.

Optional smoke knobs:

- `SMOKE_MARKET_ID` default `101`
- `SMOKE_OUTCOME` default `1`
- `SMOKE_MIN_ODDS` default `100`
- `SMOKE_STAKE_AMOUNT` default `100000000` (100 USDC)
- `SMOKE_PAYOUT_AMOUNT` default `170000000` (170 USDC)
- `SMOKE_ZK_OWNER_LABEL` default `zk-owner-smoke`
- `SMOKE_SET_CALLBACK_TO_DEPLOYER` default `true`
- `SMOKE_SET_SHIELD_TO_DEPLOYER` default `false`
- `SMOKE_RESTORE_CONFIG` default `true`

## Common Errors

1. `ERC20: transfer amount exceeds balance`

- Deployer does not have enough USDC for stake + liquidity seed.
- Lower `SMOKE_STAKE_AMOUNT` / `SMOKE_PAYOUT_AMOUNT`.

2. `execution reverted` on `redeemWin`

- `railgunShield` points to EOA or wrong contract.
- Set it to `AMOY_MOCK_RAILGUN` for smoke test.

3. `No injected wallet found`

- Browser wallet extension issue (frontend phase, not contract phase).

## Security Note

Never use real private keys or real mnemonic for production funds in this MVP setup.
