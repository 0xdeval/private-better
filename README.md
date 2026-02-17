# private-better

Private Better is currently a Hinkal-based private Aave flow on Arbitrum, exposed through a browser WebCLI.

## Current Flow

1. Login/import private session (`privacy-login` / `privacy-import`).
2. Approve and shield USDC.
3. `private-supply` creates position via adapter + vault.
4. `private-withdraw` withdraws back to private balance.

Withdraw is private-destination by default (not public recipient).

## Run

```bash
bun install
bun run dev:web
```

Open `http://localhost:3017`, then run `help`.

Validation:

```bash
bun run typecheck
bun run build:web
```

## Required Env

1. `VITE_PRIVATE_RPC`
2. `VITE_PRIVATE_EMPORIUM`
3. `VITE_SUPPLY_TOKEN`
4. `VITE_PRIVATE_SUPPLY_ADAPTER`

Optional:

1. `VITE_PRIVATE_DEBUG`
2. `VITE_PRIVATE_TEST_MNEMONIC`
3. `VITE_PRIVATE_FEE_BUFFER_BPS` (default `2000`)
4. `VITE_PRIVATE_FEE_BUFFER_MIN` (default `0.002` USDC)

## Commands

1. `privacy-login`
2. `privacy-import <mnemonic>`
3. `approve-token <amount>`
4. `shield-token <amount>`
5. `unshield-token <amount> [recipient]`
6. `private-balance`
7. `private-supply <amount>`
8. `show-positions`
9. `private-withdraw <positionId> <amount|max>`

## Fee Reserve Guard

For `private-supply` and `private-withdraw`, WebCLI estimates `flatFee` and enforces reserve:

- `reserve = flatFee + max(flatFee * bufferBps, minBuffer)`

User-visible preflight lines show:

- supply: `flatFee`, `reserve`, `required`
- withdraw: `flatFee`, `reserve`, `requiredPrivateBalance`

## Contracts

Contracts and scripts remain in `contracts/` and `scripts/`.
Use existing deploy/smoke scripts for adapter/factory/vault integration.

## Handoff Notes

For detailed integration and troubleshooting notes, see:

- `docs/hinkal-webcli-notes.md`
- `AGENT.md`
