# Hush - Evaluation Guide

## Project in brief

Hush is a WebCLI that combines Aave lending with private execution via Hinkal.

Core flow:

1. Move collateral into private balance (`shield`)
2. Supply privately to Aave (`private-supply`)
3. Borrow privately (`private-borrow`)
4. Repay privately (`private-repay`)
5. Withdraw back to private balance (`private-withdraw`)

## Quick evaluation flow

1. `login-test`
2. `private-balance usdc`
3. `private-supply 1`
4. `supply-positions`
5. `private-borrow <positionId> 0.01`
6. `private-repay <positionId> 0.005`

## Command references

- Log in to test private account: `login-test`
- Check balance: `private-balance usdc` (or `private-balance weth`)
- Supply collateral: `private-supply <amount>`
- Borrow WETH: `private-borrow <positionId> <amount>`
- Repay WETH: `private-repay <positionId> <amount>`

## Schemas and architecture links

- Supply flow schema: [`docs/supply-flow.png`](./supply-flow.png)
- Borrow flow schema: [`docs/borrow-flow.png`](./borrow-flow.png)
- Repay flow schema: [`docs/debt-repay-flow.png`](./debt-repay-flow.png)
- End-to-end sequence diagram: [`docs/sequence-diagram.png`](./sequence-diagram.png)
- User flow details: [`docs/user-flows.md`](./user-flows.md)
- Hinkal integration notes: [`docs/hinkal-integration.md`](./hinkal-integration.md)

## Notes

- `login-test` uses `VITE_LOGIN_TEST_MNEMONIC` when no mnemonic argument is provided.
- Position IDs are retrieved with `supply-positions` after a successful supply.
- `private-withdraw` needs the local withdraw auth note stored in browser localStorage.
- `withdrawAuthSecret` is shown in CLI output after supply/borrow and after secret rotation in partial repay/withdraw. Treat it like a private key and avoid sharing logs/screenshots.
