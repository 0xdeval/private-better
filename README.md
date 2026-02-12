# private-better

Private Better is now focused on private DeFi flows:

1. Railgun private balance.
2. Atomic unshield callback into adapter.
3. User-isolated vault supply to Aave-style pool.

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

## Judge Quickstart

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

For full contract behavior, troubleshooting, and step-by-step explanations, see `contracts/README.md`.
