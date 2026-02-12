# Private Supply Contracts (Junior-Friendly Guide)

This folder contains the smart-contract side of the private supply MVP:

1. User holds private balance in Railgun.
2. Railgun unshields to adapter.
3. Adapter supplies into Aave through a user vault.
4. Later, adapter withdraws from Aave and shields back to private destination.

## 1) Mental Model

Think about this system as three layers:

1. Entry layer: `PrivateSupplyAdapter` receives unshield callbacks.
2. Isolation layer: `VaultFactory` creates one `UserVault` per private owner hash.
3. Strategy layer: `UserVault` talks to Aave Pool.

Why this design:

1. A vault is shared per `zkOwnerHash`, so one private user has one isolated strategy account.
2. Position bookkeeping stays inside adapter (`positionId -> vault/token/amount`).
3. Railgun addresses stay private; contracts only store hash-like identifiers.

## 2) Contracts and Their Job

1. `contracts/PrivateSupplyAdapter.sol`
- Main orchestrator.
- `onRailgunUnshield(token, amount, data)`:
  - validates callback sender,
  - decodes `SupplyRequest { zkOwnerHash }`,
  - gets user vault from factory,
  - transfers token to vault,
  - calls vault supply,
  - stores a new position.
- `withdrawAndShield(positionId, amount, shieldToZkAddressHash)`:
  - withdraws from vault/Aave,
  - updates position amount,
  - approves shield contract,
  - calls `railgunShield.shield(...)`.

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
  - supply flow,
  - callback access control,
  - withdraw + shield flow,
  - withdraw access control.

## 3) End-to-End Behavior

### Supply path

1. Adapter receives `onRailgunUnshield`.
2. Adapter gets vault from factory.
3. Adapter sends token to vault.
4. Vault supplies to Aave.
5. Adapter creates position.

### Withdraw path

1. Owner calls `withdrawAndShield(positionId, amount, shieldHash)`.
2. Adapter resolves position and caps amount to position size when `amount=max`.
3. Vault withdraws from Aave back to adapter.
4. Adapter calls shield contract with withdrawn token.
5. Adapter reduces stored position amount.

## 4) Required .env Keys

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
2. For real Arbitrum Sepolia tests, use Arbitrum Sepolia addresses.
3. `SUPPLY_TOKEN` must be an asset listed in the selected `AAVE_POOL`.

## 5) Reproduce Everything

### A) Compile

```bash
forge build
```

### B) Deploy contracts

```bash
bash scripts/deploy-vault-factory.sh
bash scripts/deploy-private-supply-adapter.sh
```

Optional mocks:

```bash
bash scripts/deploy-mock-aave-pool.sh
bash scripts/deploy-mock-railgun.sh
```

### C) Smoke test supply

```bash
SMOKE_STAKE_AMOUNT=1000000 bash scripts/smoke-test-supply-adapter.sh
```

What success looks like:

1. Step 4 (`onRailgunUnshield`) succeeds.
2. Position is created.
3. Vault address is printed.

### D) Smoke test withdraw + shield

Recommended:

```bash
SMOKE_STAKE_AMOUNT=1000000 \
SMOKE_WITHDRAW_AMOUNT=max \
SMOKE_SET_SHIELD_TO_MOCK=true \
bash scripts/smoke-test-withdraw-supply-adapter.sh
```

What success looks like:

1. Step 6 (`withdrawAndShield`) succeeds.
2. Position amount becomes `0` (for full withdraw).
3. Mock railgun token balance increases by withdrawn amount.

## 6) Arbitrum Sepolia (Real Aave) Checklist

Before running real-Aave smoke tests:

1. `AAVE_POOL` is Arbitrum Sepolia pool.
2. `SUPPLY_TOKEN` is an underlying reserve listed in that pool.
3. Deployer wallet has Arb Sepolia ETH for gas.
4. Deployer wallet has enough `SUPPLY_TOKEN` balance.

If using real Aave + mock shield, keep:

1. `SMOKE_SET_SHIELD_TO_MOCK=true`
2. `MOCK_RAILGUN=<Arbitrum Sepolia mock railgun address>`

## 7) Common Errors and Fixes

1. `execution reverted: 51`
- Meaning: Aave reserve supply cap issue.
- Fix: choose another reserve or another testnet market with headroom.

2. `adapter supplyToken() does not match SUPPLY_TOKEN`
- Meaning: `.env` token and adapter config differ.
- Fix: call `setSupplyToken` on adapter.

3. `onRailgunUnshield` access control revert
- Meaning: caller is not current `railgunCallbackSender`.
- Fix: for smoke tests, temporarily set callback sender to deployer.

4. Withdraw revert with shared vault history
- Meaning: requested withdraw not aligned with this position amount.
- Fix: use `SMOKE_WITHDRAW_AMOUNT=max` with latest adapter logic.

## 8) Current Scope vs Next

Completed:

1. Real Aave supply path through adapter + factory + vault.
2. Withdraw from Aave and shield call path.

Next:

1. Full end-to-end Railgun integration (real callback sender + real shield).
2. Frontend commands for private supply/withdraw transaction construction.
