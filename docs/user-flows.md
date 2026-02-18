## User flows

Here are scenarios how the product works on the UI and contract side for different use cases for the private supply and withdraw

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
