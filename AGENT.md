# Hush Agent Notes

This file is the canonical handoff context for future agents working on this repo.

## 1. Current Product State

The active runtime is a Hinkal-based browser WebCLI on Arbitrum.

- Private actions: shield, unshield, unshield-weth, private supply, private borrow, private repay, private withdraw.
- Withdraw currently returns to private balance by default.
- Fee reserve preflight guard is implemented for supply/withdraw/borrow/repay (USDC fee token).
- Withdraw auth secrets are currently stored locally in browser session.
- Borrow path is USDC collateral -> WETH debt (adapter allowlist controlled by `setBorrowTokenAllowed`).

Railgun phase documents are historical context only.

## 2. Project Structure

```text
.
├─ README.md
├─ AGENT.md
├─ docs/
│  ├─ hinkal-integration.md
│  └─ user-flows.md
├─ .cursor/
│  └─ rules/
├─ src/
│  ├─ webcli/
│  │  ├─ app.ts
│  │  ├─ entry.ts
│  │  ├─ polyfills.ts
│  │  ├─ runtime.ts
│  │  ├─ commandDispatcher.ts
│  │  ├─ constants.ts
│  │  ├─ amounts.ts
│  │  ├─ abis.ts
│  │  ├─ types.ts
│  │  └─ commands/
│  │     ├─ helpCommand.ts
│  │     ├─ accountCommands.ts
│  │     └─ positionCommands.ts
│  └─ privacy/
│     ├─ constants.ts
│     ├─ privacySession.ts
│     ├─ hinkalManager.ts
│     └─ hinkal/
│        ├─ constants.ts
│        ├─ helpers.ts
│        ├─ ops.ts
│        └─ types.ts
├─ contracts/
│  ├─ PrivateSupplyAdapter.sol
│  ├─ VaultFactory.sol
│  ├─ UserVault.sol
│  ├─ test/PrivateSupplyAdapter.t.sol
│  └─ mocks/
│     ├─ MockAavePool.sol
│     ├─ MockPrivacyExecutor.sol
│     └─ MockUSDC.sol
└─ scripts/
   ├─ sanity-check-mainnet-config.sh
   ├─ deploy-contracts/
   │  ├─ deploy-vault-factory.sh
   │  └─ deploy-private-supply-adapter.sh
   ├─ smoke-tests/
   │  ├─ smoke-test-supply-adapter.sh
   │  ├─ smoke-test-withdraw-supply-adapter.sh
   │  ├─ smoke-test-borrow-supply-adapter.sh
   │  └─ smoke-test-repay-supply-adapter.sh
   └─ contracts-verification/
      ├─ verify-vault-factory-blockscout.sh
      └─ verify-private-supply-adapter-blockscout.sh
```

## 3. User Command Surface

1. `help`
2. `clear`
3. `login`
4. `login-test [mnemonic]`
5. `import <mnemonic>`
6. `approve <amount>`
7. `shield <amount>`
8. `unshield <amount> [recipient]`
9. `unshield-weth <amount> [recipient]`
10. `private-balance [usdc|weth]`
11. `private-supply <amount>`
12. `supply-positions`
13. `private-borrow <positionId> <amount>`
14. `private-repay <positionId> <amount>`
15. `private-withdraw <positionId> <amount|max>`

## 4. Critical Behavioral Invariants

1. Do not break `private-supply` flow unless explicitly requested.
2. Keep `private-withdraw` private-destination semantics:
- adapter recipient is Emporium
- no public recipient address should be required in WebCLI
3. Preserve per-position secret lifecycle:
- rotate on borrow/repay/partial-withdraw
- remove on full close
4. Keep max-withdraw fallback retry for Aave rounding edge case (`0x47bc4b2c`).
5. Do not edit `node_modules`.

## 5. Fee Model Notes

Hinkal fee is runtime-estimated, not fixed.

WebCLI guard:

- estimate `flatFee` preflight,
- compute reserve with configured buffer,
- fail early with clear message if private balance is insufficient.

Env override:

1. `VITE_PRIVATE_FEE_BUFFER_BPS` (default `2000`)

## 6. Canonical Env Keys

WebCLI:

1. `VITE_PRIVATE_EMPORIUM`
2. `VITE_PRIVATE_RPC`
3. `VITE_PRIVATE_NETWORK`
4. `VITE_SUPPLY_TOKEN`
5. `VITE_BORROW_TOKEN_WETH`
6. `VITE_PRIVATE_SUPPLY_ADAPTER`
7. `VITE_PRIVATE_FEE_BUFFER_BPS` (optional)
8. `VITE_PRIVATE_DEBUG` (optional)
9. `VITE_LOGIN_TEST_MNEMONIC` (optional)

Contracts/scripts:

1. `PRIVATE_EMPORIUM`
2. `RPC_URL`
3. `DEPLOYER_PRIVATE_KEY`
4. `AAVE_POOL`
5. `SUPPLY_TOKEN`
6. `BORROW_TOKEN`
7. `VAULT_FACTORY`
8. `PRIVATE_SUPPLY_ADAPTER`
9. `BLOCKSCOUT_VERIFIER_URL` (optional, default: `https://arbitrum.blockscout.com/api/`)

## 7. Common Failure Causes

1. `Insufficient funds`
- private spendable cannot cover action amount + reserve.

2. Adapter executor mismatch
- adapter `privacyExecutor()` differs from configured Emporium.

3. Borrow token disabled
- adapter `isBorrowTokenAllowed(BORROW_TOKEN)` is false.

4. `Transfer Failed`
- token routing/allowance mismatch in adapter path.

## 8. Agent Workflow Expectations

1. Use WebCLI flows for end-to-end checks.
2. Validate after changes:
- `bun run typecheck`
- `bun run build:web`
3. Smoke scripts (`supply` / `borrow` / `repay`) are cleanup-by-default:
- they return assets to deployer wallet unless `SMOKE_CLEANUP=false`.
- preserve `SMOKE_WITHDRAW_SECRET_LABEL` if cleanup is disabled.
- scripts are under `scripts/smoke-tests/`.
4. Keep docs updated when behavior changes:
- `README.md`
- `AGENT.md`
- `docs/hinkal-integration.md`
- `docs/user-flows.md`
- `.cursor/rules/*`
- `contracts/README.md`
