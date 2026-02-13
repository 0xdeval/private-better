# private-better

Private Better is now focused on private DeFi flows:

1. Railgun private balance.
2. Atomic unshield callback into adapter.
3. User-isolated vault supply to Aave-style pool.

## Table Of Contents

1. [Security Model (MVP)](#security-model-mvp)
2. [WebCLI Private Commands](#webcli-private-commands)
3. [WebCLI Quick Start (E2E)](#webcli-quick-start-e2e)
4. [Contracts Quick Start](#contracts-quick-start)
5. [Judge Quickstart](#judge-quickstart)
6. [Mainnet Config Sanity Check](#mainnet-config-sanity-check)

## Security Model (MVP)

1. Withdraw guard: Position secret proof

- On supply, each position stores `withdrawAuthHash = keccak256(secret)`.
- On withdraw, caller must provide matching `secret`.
- On partial withdraw, secret rotates to `nextWithdrawAuthHash` to block replay.

2. Withdraw path: Railgun-only

- Withdraw is callable only by configured Railgun callback sender.
- Even if calldata is visible, random wallets cannot execute the withdraw function directly.
- Withdraw always shields back to the position owner hash (`zkOwnerHash`) stored on position creation.

3. `railgun-forget`

- WebCLI command that deletes encrypted local Railgun session for this browser/device.
- User must import/recreate Railgun wallet after forgetting session data.

4. Token policy

- Final/mainnet token policy is native USDC on Arbitrum One: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.
- Aave pool and reserve token must match adapter config.
- Do not mix Arbitrum USDC reserve addresses (`0xFF97...` vs `0xaf88...`) in one deployment.

Recommended Arbitrum One production config:

1. `AAVE_POOL=0x794a61358D6845594F94dc1DB02A252b5b4814aD`
2. `SUPPLY_TOKEN=0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
3. `RAILGUN_CALLBACK_SENDER=0x5aD95C537b002770a39dea342c4bb2b68B1497aA`
4. `RAILGUN_SHIELD=0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9`

To install dependencies:

```bash
bun install
```

To run the web CLI:

```bash
bun run dev:web
```

Open `http://localhost:3017` and type `help`.

To build:

```bash
bun run build:web
```

## WebCLI Commands

1. `railgun-login` loads existing encrypted local Railgun session or creates a new one.
2. `railgun-import <mnemonic>` imports a Railgun wallet into local encrypted session.
3. `approve-usdc <amount>` approves Railgun contract to pull token.
4. `shield-usdc <amount>` shields token to the logged-in Railgun address.
5. `private-supply <amount>` creates private supply position and stores local withdraw secret.
6. `show-positions` lists positions for current private owner hash.
7. `private-withdraw <positionId> <amount|max>` withdraws with secret proof and rotates secret.
8. `railgun-wallet-status` shows logged-in Railgun wallet, shielded balance, tracked secrets.
9. `railgun-forget` deletes local encrypted Railgun session data.

## WebCLI Quick Start (E2E)

1. `railgun-login`
2. `approve-usdc 1`
3. `shield-usdc 1`
4. Wait until balance is spendable in Railgun POI flow.
5. `private-supply 1`
6. `show-positions`
7. `private-withdraw <positionId> max`

Expected:

1. Supply creates a position and vault-backed Aave deposit.
2. Withdraw reduces/clears position amount and shields funds back privately.

## Contracts Quick Start

From project root:

```bash
forge test -vv
bash scripts/deploy-vault-factory.sh
bash scripts/deploy-mock-aave-pool.sh
bash scripts/deploy-mock-railgun.sh
bash scripts/deploy-private-supply-adapter.sh
SMOKE_STAKE_AMOUNT=1000000 bash scripts/smoke-test-supply-adapter.sh
```

Then test withdraw:

```bash
SMOKE_STAKE_AMOUNT=1000000 SMOKE_WITHDRAW_AMOUNT=max SMOKE_SET_SHIELD_TO_MOCK=true bash scripts/smoke-test-withdraw-supply-adapter.sh
```

## Quickstart

Minimal `.env` keys required:

```env
RPC_URL=
DEPLOYER_PRIVATE_KEY=
SUPPLY_TOKEN=
AAVE_POOL=
RAILGUN_CALLBACK_SENDER=
RAILGUN_SHIELD=
VAULT_FACTORY=
PRIVATE_SUPPLY_ADAPTER=
MOCK_RAILGUN=
```

Use these commands to reproduce the core flow quickly:

```bash
forge build
bash scripts/deploy-vault-factory.sh && bash scripts/deploy-private-supply-adapter.sh
SMOKE_STAKE_AMOUNT=1000000 SMOKE_WITHDRAW_AMOUNT=max SMOKE_SET_SHIELD_TO_MOCK=true bash scripts/smoke-test-withdraw-supply-adapter.sh
```

Expected result:

1. Supply succeeds (`onRailgunUnshield` path).
2. Withdraw succeeds (`withdrawAndShield` path).
3. Position amount becomes `0` for full withdraw.

## Mainnet Config Sanity Check

Use read-only validation before broadcast:

```bash
bash scripts/sanity-check-mainnet-config.sh
```

This checks:

1. Adapter config matches `.env`.
2. `SUPPLY_TOKEN` exists as an active reserve on selected `AAVE_POOL`.
3. Warns if Arbitrum One canonical values differ from expected native-USDC defaults.

For full contract behavior, troubleshooting, and step-by-step explanations, see `contracts/README.md`.
