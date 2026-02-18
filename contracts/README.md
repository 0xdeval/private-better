# Contracts Overview

This module implements private supply/withdraw routing with per-owner vault isolation.

## Core Contracts

1. `PrivateSupplyAdapter`
   Main contract that orchestrate all actions for a private wallet

- Supply privately: `onPrivateDeposit(token, amount, data)`
- Withdraw privately to a private address: `withdrawToRecipient(positionId, amount, withdrawAuthSecret, nextWithdrawAuthHash, recipient)`
- Stores positions keyed by `positionId` and owner index by `zkOwnerHash`.
- Access controlled by `privacyExecutor`.

2. `VaultFactory`
   Factory that issue `UserVault` contract per each `zkOwnerHash`

- One vault per `zkOwnerHash`
- Adapter-only vault creation

3. `UserVault`
   The contract that supply and stores the aave token

- Supplies token to Aave pool
- Withdraws from Aave directly to a recipient address

## Security Model (MVP)

1. `privacyExecutor` is the only caller allowed to trigger private deposit/withdraw callbacks. For Hinkal `actionPrivateWallet` stateless ops, this should be the chain Emporium address
2. Each position stores `withdrawAuthHash`
3. Withdraw requires matching secret and rotates secret on partial withdraw
4. Vault account identity is `zkOwnerHash`, not public EOA

## Required Env Keys

1. `RPC_URL`
2. `DEPLOYER_PRIVATE_KEY`
3. `PRIVATE_EMPORIUM` (set to Hinkal Emporium on your chain)
4. `SUPPLY_TOKEN`
5. `AAVE_POOL` (can be real contract or mock from `contracts/mocks/MockAavePool.sol`)
6. `VAULT_FACTORY` (after the deploy using `scripts/deploy-vault-factory.sh`)
7. `PRIVATE_SUPPLY_ADAPTER` (after deploy using `scripts/deploy-private-supply-adapter.sh`)

## Scripts

1. Deploy factory:

```bash
bash scripts/deploy-vault-factory.sh
```

2. Deploy adapter:

```bash
bash scripts/deploy-private-supply-adapter.sh
```

3. Supply smoke:

```bash
bash scripts/smoke-test-supply-adapter.sh
```

4. Withdraw smoke:

```bash
bash scripts/smoke-test-withdraw-supply-adapter.sh
```

5. Sanity check:

```bash
bash scripts/sanity-check-mainnet-config.sh
```
