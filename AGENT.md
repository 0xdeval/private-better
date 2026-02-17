# Private Better Agent Notes

This file is the canonical handoff context for future agents working on this repo.

## 1. Current Product State

The active runtime is a Hinkal-based browser WebCLI on Arbitrum.

- Private actions: shield, unshield, private supply, private withdraw.
- Withdraw currently returns to private balance by default.
- Fee reserve preflight guard is implemented for supply/withdraw.

Railgun phase documents in old files are historical and should not be treated as current implementation state.

## 2. Project Structure

```text
.
├─ README.md
├─ AGENT.md
├─ docs/
│  └─ hinkal-webcli-notes.md
├─ .cursor/
│  └─ rules/
│     ├─ 000-general-project-context.mdc
│     ├─ 050-hinkal-webcli-handoff.mdc
│     └─ (older phase files are historical)
├─ src/
│  ├─ webcli/
│  │  ├─ entry.ts
│  │  ├─ app.ts
│  │  └─ polyfills.ts
│  ├─ privacy/
│  │  ├─ hinkalManager.ts
│  │  ├─ privacyConstants.ts
│  │  ├─ privacySession.ts
│  │  ├─ privacySessionNode.ts
│  │  └─ privacyNodeConstants.ts
│  ├─ utils/
│  │  └─ generateRailgunWalletPhrase.ts
│  └─ servercli/
│     └─ (currently empty)
├─ contracts/
├─ scripts/
└─ vite.config.ts
```

## 3. Key Runtime Files

1. `src/webcli/app.ts`
- command handling
- wallet/signer preflight
- fee reserve guard
- private supply/withdraw orchestration

2. `src/privacy/hinkalManager.ts`
- Hinkal SDK session and actions
- `shieldToken`, `unshieldToken`, `privateSupply`, `privateWithdraw`

3. `src/privacy/privacySession.ts`
- encrypted browser-side session persistence

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

Env overrides:

1. `VITE_PRIVATE_FEE_BUFFER_BPS` (default `2000`)
2. `VITE_PRIVATE_FEE_BUFFER_MIN` (default `0.002` USDC)

## 6. Common Failure Causes

1. `Insufficient funds`
- usually private spendable cannot cover action amount + reserve

2. Adapter executor mismatch
- adapter `privacyExecutor()` differs from configured Emporium

3. `Transfer Failed`
- usually token routing/allowance mismatch in adapter path

## 7. Agent Workflow Expectations

1. Use WebCLI flows for end-to-end checks.
2. Validate after changes:
- `bun run typecheck`
- `bun run build:web`
3. Keep docs updated when behavior changes:
- `README.md`
- `AGENT.md`
- `docs/hinkal-webcli-notes.md`
- `.cursor/rules/*`
