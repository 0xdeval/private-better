# Overview

Hush brings private DeFi UX to Aave: users can supply USDC privately as collateral, borrow WETH privately, and manage repay/withdraw flows without exposing strategy identity.

**The core privacy infrastructure that is used under the hood is provided by the [Hinkal protocol](https://hinkal.pro/). More information about the integration ["Hinkal integration" page](docs/hinkal-integration.md)**

📋 [Evaluation guide](docs/evaluation-guide.md)

**Supply mechanism:**
![value-flow](docs/supply-flow.png)

**Borrow mechanism:**
![value-flow](docs/borrow-flow.png)

## Table of Contents

- [How does it work?](#how-does-it-work)
- [User flows](#user-flows)
  - [All WebCLI commands](#all-webcli-commands)
- [Get started](#get-started)
- [Contract smoke tests (auto-cleanup)](#contract-smoke-tests-auto-cleanup)
- [Environment variables](#environment-variables)
  - [WebCLI (`.env`)](#webcli-env)
  - [Contracts / scripts (`.env`)](#contracts--scripts-env)
- [Fee reserve guard](#fee-reserve-guard)
- [Roadmap](#roadmap)
  - [Next improvements](#next-improvements)
  - [Withdraw Auth Note](#withdraw-auth-note)
- [Other files](#other-files)

## How does it work?

To get the full how the product works, you can refer to the [sequence diagram](docs/sequence-diagram.png)

Here is a short recap:

1. Login/import private session (`login` / `login-test` / `import`)
2. `approve 1` to approve 1 USDC (**better min 1 USDC for a smoother experience**)
3. `shield 1` to add 1 USDC to a private wallet (**better min 1 USDC for a smoother experience**)
4. `unshield 1` unshield and withdraw 1 USDC to a connected public wallet
5. `unshield-weth 0.005` unshield and withdraw 0.005 WETH to a connected public wallet
6. `private-supply 1` supplies USDC to AAVE as collateral
7. `private-borrow 1 0.01` borrows WETH into private balance
8. `private-repay 1 0.005` repays debt from private WETH balance
9. `private-withdraw 1 max` withdraws collateral back to private balance

**Withdraw is private-destination by default (not public recipient)**

‼️ Warning:
`withdrawAuthSecret` is sensitive and is currently shown in CLI output after `private-supply`, `private-borrow`, and after secret rotation in partial `private-withdraw` / `private-repay`. It is also stored in encrypted browser local storage.

So:

- Anyone who gets the latest secret for a position can execute auth-protected actions for that position (`private-withdraw`, `private-borrow`, `private-repay`) and may drain user funds.
- If you clear browser cache/local storage, local withdraw auth secrets are deleted.
- Without the correct withdraw auth secret, you cannot call `private-withdraw` for existing supplied positions.
- Do not share terminal logs/screenshots, and clear terminal output after operations that print secrets.

## User flows

Get more about user flows on the ["User flows" page](docs/user-flows.md)

Evaluation docs:

- [Evaluation guide](docs/evaluation-guide.md)
- [Supply flow schema](docs/supply-flow.png)
- [Borrow flow schema](docs/borrow-flow.png)
- [Repay flow schema](docs/debt-repay-flow.png)
- [Sequence diagram](docs/sequence-diagram.png)

### All WebCLI commands

| Command            | Arguments                      | Description                                             | Example                  |
| ------------------ | ------------------------------ | ------------------------------------------------------- | ------------------------ |
| `help`             | none                           | Show available commands                                 | `help`                   |
| `clear`            | none                           | Clear terminal output                                   | `clear`                  |
| `login`            | none                           | Create/load encrypted local private session             | `login`                  |
| `login-test`       | `[mnemonic]`                   | Load test private session from arg or `.env` mnemonic   | `login-test`             |
| `import`           | `<mnemonic>`                   | Import private session from mnemonic                    | `import word1 word2 ...` |
| `approve`          | `<amount>`                     | Approve token spend for Hinkal shield flow              | `approve 1.5`            |
| `shield`           | `<amount>`                     | Move public token balance to private balance            | `shield 1.5`             |
| `unshield`         | `<amount> [recipient]`         | Move private balance back to public address             | `unshield 0.5`           |
| `unshield-weth`    | `<amount> [recipient]`         | Move private WETH balance to public address             | `unshield-weth 0.005`    |
| `private-balance`  | `[usdc \| weth]`               | Show private spendable token balance                    | `private-balance weth`   |
| `private-supply`   | `<amount>`                     | Supply private funds to Aave via adapter/vault          | `private-supply 1.0`     |
| `supply-positions` | none                           | List private supply positions for current private owner | `supply-positions`       |
| `private-withdraw` | `<positionId> <amount OR max>` | Withdraw from Aave position back to private balance     | `private-withdraw 1 max` |
| `private-borrow`   | `<positionId> <amount>`        | Borrow WETH privately from a collateralized position    | `private-borrow 1 0.01`  |
| `private-repay`    | `<positionId> <amount>`        | Repay WETH debt privately from private balance          | `private-repay 1 0.005`  |

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

## Contract smoke tests (auto-cleanup)

These smoke scripts now use funds during execution and then return assets back to the deployer wallet by default:

- `bash scripts/smoke-test-supply-adapter.sh`
- `bash scripts/smoke-test-borrow-supply-adapter.sh`
- `bash scripts/smoke-test-repay-supply-adapter.sh`

Default behavior:

- `SMOKE_CLEANUP=true` (default): script repays/withdraws and closes position where possible.
- `SMOKE_RESTORE_EXECUTOR=true` (default): script restores adapter executor back to original value.
- `SMOKE_WITHDRAW_SECRET_LABEL` auto-generates per run by default.

Optional flags:

- `SMOKE_CLEANUP=false` to keep test position open intentionally.
- `SMOKE_WITHDRAW_SECRET_LABEL=...` to control deterministic auth secrets used in test flow.

Important:

- If you disable cleanup, you must keep `SMOKE_WITHDRAW_SECRET_LABEL` to recover those positions later.
- For borrow smoke cleanup, recipient should remain deployer (default) so borrowed token is available for repay.

Safe run (recommended, no extra flags needed):

```bash
bash scripts/smoke-test-supply-adapter.sh
bash scripts/smoke-test-borrow-supply-adapter.sh
bash scripts/smoke-test-repay-supply-adapter.sh
```

## Environment variables

### WebCLI (`.env`)

| Variable                      | Required | Purpose                                                    | Example / Default                            |
| ----------------------------- | -------- | ---------------------------------------------------------- | -------------------------------------------- |
| `VITE_PRIVATE_EMPORIUM`       | Yes      | Hinkal Emporium contract address (privacy executor target) | `0xcA64D9B41710Bd6e1818D3F0bED939F8e7c5a490` |
| `VITE_PRIVATE_RPC`            | Yes      | RPC endpoint used by WebCLI/Hinkal                         | `https://arb1.arbitrum.io/rpc`               |
| `VITE_PRIVATE_NETWORK`        | Yes      | Network label                                              | `Arbitrum`                                   |
| `VITE_SUPPLY_TOKEN`           | Yes      | ERC20 used for private supply (USDC on Arbitrum)           | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `VITE_BORROW_TOKEN_WETH`      | Yes      | Borrow token (WETH on Arbitrum)                            | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` |
| `VITE_PRIVATE_SUPPLY_ADAPTER` | Yes      | Deployed `PrivateSupplyAdapter` contract address           | `0x...`                                      |
| `VITE_PRIVATE_FEE_BUFFER_BPS` | No       | Extra fee buffer (basis points) for private actions        | `2000` (20%)                                 |
| `VITE_PRIVATE_DEBUG`          | No       | Enable debug logs (`1` or `0`)                             | `0`                                          |
| `VITE_LOGIN_TEST_MNEMONIC`    | No       | Optional mnemonic used by `login-test`                     | `"word1 word2 ..."`                          |

### Contracts / scripts (`.env`)

| Variable                  | Required    | Purpose                                                            | Example / Default                            |
| ------------------------- | ----------- | ------------------------------------------------------------------ | -------------------------------------------- |
| `PRIVATE_EMPORIUM`        | Yes         | Emporium address used as adapter executor config                   | `0xcA64D9B41710Bd6e1818D3F0bED939F8e7c5a490` |
| `RPC_URL`                 | Yes         | RPC endpoint for deploy/smoke scripts                              | `https://arb1.arbitrum.io/rpc`               |
| `DEPLOYER_PRIVATE_KEY`    | Yes         | Private key used by `forge`/`cast` in scripts                      | `0x...`                                      |
| `AAVE_POOL`               | Yes         | Aave Pool contract address                                         | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| `SUPPLY_TOKEN`            | Yes         | ERC20 token used by adapter/vault                                  | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| `BORROW_TOKEN`            | Yes         | Borrow token allowlisted in adapter (WETH on Arbitrum)             | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` |
| `VAULT_FACTORY`           | Conditional | Required after factory deploy, and for adapter deploy/smoke checks | `0x...`                                      |
| `PRIVATE_SUPPLY_ADAPTER`  | Conditional | Required after adapter deploy, and for smoke/sanity scripts        | `0x...`                                      |
| `BLOCKSCOUT_VERIFIER_URL` | No          | Blockscout API URL for verification scripts                        | `https://arbitrum.blockscout.com/api/`       |

## Fee reserve guard

For `private-supply`, `private-withdraw`, `private-borrow`, and `private-repay`, WebCLI estimates `flatFee` and enforces reserve (fee token is private USDC):

- `reserve = flatFee + max(flatFee * bufferBps, minBuffer)`

User-visible preflight lines show:

- supply: `flatFee`, `reserve`, `required`
- withdraw: `flatFee`, `reserve`, `requiredPrivateBalance`
- borrow: `flatFee`, `reserve`, `requiredPrivateUSDC`
- repay: `flatFee`, `reserve`, `requiredPrivateUSDC`

## Roadmap

### Next improvements

- Multi-asset private borrow support beyond WETH
- Richer risk/health-factor UX in WebCLI

### Withdraw Auth Note

Today, withdraw auth secrets are stored in the local browser session for created positions.
The same secrets are printed in terminal output after supply/borrow/repay/withdraw rotation to help backup.
A future UX update will replace this with safer secret management and explicit secure export/import.

‼️ Warning:
The latest secret is enough to control a position.

So:

- Treat `withdrawAuthSecret` like a private key.
- Do not store it in chat logs, screenshots, cloud notes, or shared terminals.
- Rotate and store only the latest secret for each position.

## Other files

Contracts and scripts remain in `contracts/` and `scripts/`
Use existing deploy/smoke scripts for adapter/factory/vault integration
For detailed integration and troubleshooting notes, see:

- `docs/hinkal-integration.md`
- `docs/user-flows.md`
- `AGENT.md`
