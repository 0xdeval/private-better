# Overview

Private Better is a Hinkal-based private liquidity supply on Aave on Arbitrum, exposed through a browser WebCLI

## How does it work?

1. Login/import private session (`login` / `import`)
2. `approve 1` to approve 1 USDC (**better min 1 USDC for a smoother experience**)
3. `shield 1` to add 1 USDC to a private wallet (**better min 1 USDC for a smoother experience**)
4. `private-supply 1` supply USDC to AAVE as a collateral and start earning yield
5. `private-withdraw max` withdraws back to private balance

## Hinkal protocol integration

Get more about how the Hinkal protocol integration works on the ["Hinkal integration" page](https://github.com/0xdeval/private-better/blob/main/docs/hinkal-integration.md)

## User flows

Get more about user flows on the ["User flows" page](https://github.com/0xdeval/private-better/blob/main/docs/user-flows.md)

**Withdraw is private-destination by default (not public recipient)**

### All WebCLI commands

| Command            | Arguments                      | Description                                             | Example                  |
| ------------------ | ------------------------------ | ------------------------------------------------------- | ------------------------ |
| `help`             | none                           | Show available commands                                 | `help`                   |
| `clear`            | none                           | Clear terminal output                                   | `clear`                  |
| `login`            | none                           | Create/load encrypted local private session             | `login`                  |
| `import`           | `<mnemonic>`                   | Import private session from mnemonic                    | `import word1 word2 ...` |
| `approve`          | `<amount>`                     | Approve token spend for Hinkal shield flow              | `approve 1.5`            |
| `shield`           | `<amount>`                     | Move public token balance to private balance            | `shield 1.5`             |
| `unshield`         | `<amount> [recipient]`         | Move private balance back to public address             | `unshield 0.5`           |
| `private-balance`  | none                           | Show private spendable token balance                    | `private-balance`        |
| `private-supply`   | `<amount>`                     | Supply private funds to Aave via adapter/vault          | `private-supply 1.0`     |
| `supply-positions` | none                           | List private supply positions for current private owner | `supply-positions`       |
| `private-withdraw` | `<positionId> <amount OR max>` | Withdraw from Aave position back to private balance     | `private-withdraw 1 max` |

## Get started

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

## Environment variables

### WebCLI (`.env`)

| Variable                      | Required | Purpose                                                    | Example / Default                            |
| ----------------------------- | -------- | ---------------------------------------------------------- | -------------------------------------------- |
| `VITE_PRIVATE_EMPORIUM`       | Yes      | Hinkal Emporium contract address (privacy executor target) | `0xcA64D9B41710Bd6e1818D3F0bED939F8e7c5a490` |
| `VITE_PRIVATE_RPC`            | Yes      | RPC endpoint used by WebCLI/Hinkal                         | `https://arb1.arbitrum.io/rpc`               |
| `VITE_PRIVATE_NETWORK`        | Yes      | Network label                                              | `Arbitrum`                                   |
| `VITE_SUPPLY_TOKEN`           | Yes      | ERC20 used for private supply (USDC on Arbitrum)           | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `VITE_PRIVATE_SUPPLY_ADAPTER` | Yes      | Deployed `PrivateSupplyAdapter` contract address           | `0x...`                                      |
| `VITE_PRIVATE_FEE_BUFFER_BPS` | No       | Extra fee buffer (basis points) for private actions        | `2000` (20%)                                 |
| `VITE_PRIVATE_DEBUG`          | No       | Enable debug logs (`1` or `0`)                             | `0`                                          |

### Contracts / scripts (`.env`)

| Variable                 | Required    | Purpose                                                            | Example / Default                            |
| ------------------------ | ----------- | ------------------------------------------------------------------ | -------------------------------------------- |
| `PRIVATE_EMPORIUM`       | Yes         | Emporium address used as adapter executor config                   | `0xcA64D9B41710Bd6e1818D3F0bED939F8e7c5a490` |
| `RPC_URL`                | Yes         | RPC endpoint for deploy/smoke scripts                              | `https://arb1.arbitrum.io/rpc`               |
| `DEPLOYER_PRIVATE_KEY`   | Yes         | Private key used by `forge`/`cast` in scripts                      | `0x...`                                      |
| `AAVE_POOL`              | Yes         | Aave Pool contract address                                         | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| `SUPPLY_TOKEN`           | Yes         | ERC20 token used by adapter/vault                                  | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `VAULT_FACTORY`          | Conditional | Required after factory deploy, and for adapter deploy/smoke checks | `0x...`                                      |
| `PRIVATE_SUPPLY_ADAPTER` | Conditional | Required after adapter deploy, and for smoke/sanity scripts        | `0x...`                                      |

## Fee reserve guard

For `private-supply` and `private-withdraw`, WebCLI estimates `flatFee` and enforces reserve:

- `reserve = flatFee + max(flatFee * bufferBps, minBuffer)`

User-visible preflight lines show:

- supply: `flatFee`, `reserve`, `required`
- withdraw: `flatFee`, `reserve`, `requiredPrivateBalance`

## Roadmap

### AAVE borrowing

Current private yield functionality is focused on supply
Borrow functionality is planned next on top of the same private position architecture

### Withdraw Auth Note

Today, withdraw auth secrets are stored in the local browser session for created positions
A future UX update will let users explicitly save/export withdraw auth so they can complete withdraws later across sessions/devices

## Other files

Contracts and scripts remain in `contracts/` and `scripts/`
Use existing deploy/smoke scripts for adapter/factory/vault integration
For detailed integration and troubleshooting notes, see:

- `docs/hinkal-webcli-notes.md`
- `AGENT.md`
