# Private Better Agent Notes

This file is the canonical handoff context for future agents working on this repo.

## 1. Current Product State

The active runtime is a Hinkal-based browser WebCLI on Arbitrum.

- Private actions: shield, unshield, private supply, private withdraw.
- Withdraw currently returns to private balance by default.
- Fee reserve preflight guard is implemented for supply/withdraw.
- Withdraw auth secrets are currently stored locally in browser session.
- Product focus is private supply; private borrow is planned next.

Railgun phase documents are historical context only.

## 2. Project Structure

```text
.
├─ README.md
├─ AGENT.md
├─ docs/
│  └─ hinkal-webcli-notes.md
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
   ├─ deploy-vault-factory.sh
   ├─ deploy-private-supply-adapter.sh
   ├─ smoke-test-supply-adapter.sh
   ├─ smoke-test-withdraw-supply-adapter.sh
   └─ sanity-check-mainnet-config.sh
```

## 3. User Command Surface

1. `help`
2. `clear`
3. `login`
4. `import <mnemonic>`
5. `approve <amount>`
6. `shield <amount>`
7. `unshield <amount> [recipient]`
8. `private-balance`
9. `private-supply <amount>`
10. `supply-positions`
11. `private-withdraw <positionId> <amount|max>`

## 4. Critical Behavioral Invariants

1. Do not break `private-supply` flow unless explicitly requested.
2. Keep `private-withdraw` private-destination semantics:
- adapter recipient is Emporium
- Hinkal recipient metadata is provided (`recipientData`)
3. Preserve per-position secret lifecycle:
- rotate on partial withdraw
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
5. `VITE_PRIVATE_SUPPLY_ADAPTER`
6. `VITE_PRIVATE_FEE_BUFFER_BPS` (optional)
7. `VITE_PRIVATE_DEBUG` (optional)

Contracts/scripts:

1. `PRIVATE_EMPORIUM`
2. `RPC_URL`
3. `DEPLOYER_PRIVATE_KEY`
4. `AAVE_POOL`
5. `SUPPLY_TOKEN`
6. `VAULT_FACTORY`
7. `PRIVATE_SUPPLY_ADAPTER`

## 7. Common Failure Causes

1. `Insufficient funds`
- private spendable cannot cover action amount + reserve.

2. Adapter executor mismatch
- adapter `privacyExecutor()` differs from configured Emporium.

3. `Transfer Failed`
- token routing/allowance mismatch in adapter path.

## 8. Agent Workflow Expectations

1. Use WebCLI flows for end-to-end checks.
2. Validate after changes:
- `bun run typecheck`
- `bun run build:web`
3. Keep docs updated when behavior changes:
- `README.md`
- `AGENT.md`
- `docs/hinkal-webcli-notes.md`
- `.cursor/rules/*`
- `contracts/README.md`
