# Phase 2 Contracts (Mock-First)

This folder contains a hackathon-speed implementation for the Atomic Private Bet flow.

## Files

- `PrivateBetAdapter.sol`
- `mocks/MockUSDC.sol`
- `mocks/MockAzuro.sol`
- `mocks/MockRailgun.sol`
- `interfaces/*`
- `utils/Ownable.sol`

## Flow

1. Mock Railgun transfers USDC to `PrivateBetAdapter` and calls:
   - `onRailgunUnshield(token, amount, data)`
2. Adapter decodes:
   - `BetRequest { marketId, outcome, minOdds, zkOwnerHash }`
3. Adapter approves Azuro and places bet in the same call.
4. Adapter stores `betTokenId -> BetPosition`.
5. On win, `redeemWin(betTokenId)`:
   - claims from Azuro
   - approves Railgun shield
   - calls `railgunShield.shield(token, payout, zkOwnerHash)`

## Bet Request Encoding

The callback payload is encoded as:

```solidity
abi.encode(
  PrivateBetAdapter.BetRequest({
    marketId: ...,
    outcome: ...,
    minOdds: ...,
    zkOwnerHash: ...
  })
)
```

## Minimal Local Test Sequence

1. Deploy `MockUSDC`.
2. Deploy `MockAzuro`.
3. Deploy `MockRailgun`.
4. Deploy `PrivateBetAdapter(railgunCallbackSender=mockRailgun, railgunShield=mockRailgun, azuro=mockAzuro, usdc=mockUSDC)`.
5. `MockRailgun.setAdapter(adapter)`.
6. Mint USDC to owner and approve:
   - `MockRailgun` for unshield pool deposit.
   - `MockAzuro` for liquidity seed.
7. `MockRailgun.depositToken(usdc, amountForBets)`.
8. `MockAzuro.seedLiquidity(usdc, amountForPayouts)`.
9. Build bet data and call:
   - `MockRailgun.unshieldToAdapter(usdc, stake, data)`.
10. Set payout:
    - `MockAzuro.settleBet(tokenId, payout)`.
11. Redeem:
    - `PrivateBetAdapter.redeemWin(tokenId)`.

Expected result:

- Adapter bet is recorded.
- Azuro payout is claimed.
- Mock Railgun emits `ShieldedToPrivate(...)` with `zkOwnerHash`.
