## User flows

Here are scenarios how the product works on the UI and contract side for private supply, borrow, repay, and withdraw.

### Notes

- Debt is tracked at the vault level by Aave, not synthetic per-position accounting in adapter storage.
- Authorization for sensitive actions is per-position secret hash:
  - secret must match current stored hash
  - successful borrow/repay rotates the hash.
- Borrow/repay fee reserve checks are enforced in private USDC by WebCLI before submission.
- WebCLI currently prints `WithdrawAuth backup` in terminal after secret-changing actions; if leaked, the latest secret can be used to control that position.

### Evaluation walkthrough

Use this command sequence for a quick end-to-end product review.

1. Optional setup in `.env`: set `VITE_LOGIN_TEST_MNEMONIC="word1 word2 ..."`
2. Run `login-test` to load the test private account
3. Run `private-balance usdc` to check available private collateral
4. Run `private-supply <amount>` to supply private collateral to Aave
5. Run `supply-positions` to get the current `positionId`
6. Run `private-borrow <positionId> <amount>` to borrow private WETH
7. Run `private-repay <positionId> <amount>` to repay private WETH debt

### First-time private supply flow

On frontend:

1. User runs `private-supply <amount>` in WebCLI
2. WebCLI builds a Hinkal private action with 2 Emporium ops:
   - `ERC20.transfer(adapter, amount)`
   - `PrivateSupplyAdapter.onPrivateDeposit(token, amount, data)`
     data includes `zkOwnerHash` + `withdrawAuthHash`

In contracts:

1. `PrivateSupplyAdapter` validates caller (`privacyExecutor`) and token config
2. Adapter asks `VaultFactory` for vault by `zkOwnerHash`
3. Since it is first supply, `VaultFactory` deploys a new `UserVault` and stores mapping `zkOwnerHash -> vault`
4. Adapter routes funds into that vault; vault supplies to Aave pool
5. Adapter stores/updates position state (positionId, owner hash, token, amount, withdrawAuthHash)

### Private withdraw flow

On frontend:

1. User runs `private-withdraw <positionId> <amount|max>`
2. WebCLI loads local `withdrawAuthSecret` for this position and creates `nextWithdrawAuthHash` (for rotation)
3. WebCLI builds Hinkal private action calling:
   - `PrivateSupplyAdapter.withdrawToRecipient(positionId, amount, withdrawAuthSecret, nextWithdrawAuthHash, emporium)`

In contracts:

1. Adapter validates caller (`privacyExecutor`)
2. Verifies provided secret matches stored `withdrawAuthHash`
3. Calls vault/Aave withdraw path to pull funds out
4. Sends withdrawn funds to recipient (Emporium for private-credit flow)
5. Updates position amount
   - If partial withdraw: stores new `withdrawAuthHash` (rotated)
   - If full withdraw: position amount becomes zero (and hash cleared/closed state)

### Private borrow flow

On frontend:

1. User runs `private-borrow <positionId> <amount>`
2. WebCLI loads local auth secret and creates `nextAuthHash`
3. WebCLI builds Hinkal private action calling:
   - `PrivateSupplyAdapter.borrowToRecipient(positionId, debtToken, amount, authSecret, nextAuthHash, emporium)`

In contracts:

1. Adapter validates caller (`privacyExecutor`)
2. Verifies position exists and auth secret hash matches
3. Validates borrow token is allowlisted
4. Calls vault/Aave borrow path with variable rate mode
5. Routes borrowed WETH to Emporium (private-credit flow)
6. Rotates stored auth hash

### Private repay flow

On frontend:

1. User runs `private-repay <positionId> <amount>`
2. WebCLI checks private WETH balance and private USDC fee reserve
3. WebCLI builds Hinkal private action with 2 ops:
   - `ERC20.transfer(adapter, amount)` for WETH
   - `PrivateSupplyAdapter.repayFromPrivate(positionId, debtToken, amount, authSecret, nextAuthHash)`

In contracts:

1. Adapter validates caller (`privacyExecutor`)
2. Verifies auth secret and borrow token allowlist
3. Transfers WETH from adapter to vault
4. Vault calls Aave repay on behalf of the vault
5. Adapter rotates stored auth hash
