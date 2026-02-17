# private-better

Private Better now uses a Hinkal-first private flow for Arbitrum:

1. Public wallet signs and pays gas.
2. Funds are moved through private execution flow.
3. Adapter routes supply to per-owner vaults on Aave.
4. Withdraw uses per-position secret auth and returns funds to recipient.

## Install / Run

```bash
bun install
bun run dev:web
```

Open `http://localhost:3017` and type `help`.

Build:

```bash
bun run build:web
```

Server CLI (no browser/Vite runtime):

```bash
bun run dev:cli
```

## WebCLI Env Variables

Required:

1. `VITE_PRIVATE_RPC`
2. `VITE_PRIVATE_EMPORIUM` (optional override; defaults to Arbitrum Emporium)
3. `VITE_SUPPLY_TOKEN`

Required after adapter deploy:

1. `VITE_PRIVATE_SUPPLY_ADAPTER`

Optional:

1. `VITE_PRIVATE_NETWORK` (default: `Arbitrum`)
2. `VITE_PRIVATE_TEST_MNEMONIC` (dev-only)

## Server CLI Env Variables

Required:

1. `VITE_PRIVATE_RPC` (or `RPC_URL`)
2. `VITE_PRIVATE_EMPORIUM` (or `PRIVATE_EMPORIUM`, optional override)
3. `VITE_SUPPLY_TOKEN` (or `SUPPLY_TOKEN`)
4. `PRIVATE_WALLET_PRIVATE_KEY` (or `DEPLOYER_PRIVATE_KEY`)

Required after adapter deploy:

1. `VITE_PRIVATE_SUPPLY_ADAPTER` (or `PRIVATE_SUPPLY_ADAPTER`)

## Contract Script Env Variables

Required:

1. `RPC_URL`
2. `DEPLOYER_PRIVATE_KEY`
3. `PRIVACY_EXECUTOR` (must be Hinkal Emporium address for your chain)
4. `SUPPLY_TOKEN`
5. `AAVE_POOL`
6. `VAULT_FACTORY`

Required after adapter deploy:

1. `PRIVATE_SUPPLY_ADAPTER`

## WebCLI Commands

1. `privacy-login`
2. `privacy-import <mnemonic>`
3. `approve-token <amount>`
4. `shield-token <amount>`
5. `unshield-token <amount> [recipient]`
6. `private-supply <amount>`
7. `show-positions`
8. `private-withdraw <positionId> <amount|max>`

The Server CLI uses the same command set (`help` to list). Session data is stored in `.data/privacy-session.json`.

## Expected Runtime Behavior Before Deploy Addresses Are Set

1. Build/typecheck pass.
2. `help`, `privacy-login`, and other non-contract commands work.
3. Contract commands fail fast with clear missing key messages:
   - `VITE_PRIVATE_SUPPLY_ADAPTER`
   - `PRIVATE_SUPPLY_ADAPTER`
   - `VAULT_FACTORY`

## Deploy Sequence

1. Deploy factory:

```bash
bash scripts/deploy-vault-factory.sh
```

2. Deploy adapter:

```bash
bash scripts/deploy-private-supply-adapter.sh
```

3. Set env values from deployment output:

1. `VITE_PRIVATE_SUPPLY_ADAPTER`
2. `PRIVATE_SUPPLY_ADAPTER`
3. `VAULT_FACTORY`

4. Run sanity check:

```bash
bash scripts/sanity-check-mainnet-config.sh
```

5. Run smoke tests:

```bash
bash scripts/smoke-test-supply-adapter.sh
bash scripts/smoke-test-withdraw-supply-adapter.sh
```
