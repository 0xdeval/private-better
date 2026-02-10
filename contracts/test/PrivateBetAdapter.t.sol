// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrivateBetAdapter} from "../PrivateBetAdapter.sol";
import {MockAzuro} from "../mocks/MockAzuro.sol";
import {MockRailgun} from "../mocks/MockRailgun.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract PrivateBetAdapterTest {
  MockUSDC internal usdc;
  MockAzuro internal azuro;
  MockRailgun internal railgun;
  PrivateBetAdapter internal adapter;

  uint256 internal constant USDC_1 = 1_000_000;
  uint256 internal constant STAKE = 100 * USDC_1;
  uint256 internal constant PAYOUT = 170 * USDC_1;

  function setUp() public {
    usdc = new MockUSDC();
    azuro = new MockAzuro();
    railgun = new MockRailgun();
    adapter = new PrivateBetAdapter(address(railgun), address(railgun), address(azuro), address(usdc));

    railgun.setAdapter(address(adapter));

    usdc.mint(address(this), 2_000 * USDC_1);
    usdc.approve(address(railgun), type(uint256).max);
    usdc.approve(address(azuro), type(uint256).max);

    railgun.depositToken(address(usdc), 600 * USDC_1);
    azuro.seedLiquidity(address(usdc), 1_000 * USDC_1);
  }

  function testUnshieldPlaceBetRedeemWinFlow() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-1");
    bytes memory data = _betRequestData(101, 1, 100, zkOwnerHash);

    uint256 tokenId = railgun.unshieldToAdapter(address(usdc), STAKE, data);
    require(tokenId == 1, "expected tokenId 1");

    (bytes32 storedOwnerHash, address token, uint256 stake, bool claimedBefore) = adapter.positions(tokenId);
    require(storedOwnerHash == zkOwnerHash, "position owner mismatch");
    require(token == address(usdc), "position token mismatch");
    require(stake == STAKE, "position stake mismatch");
    require(!claimedBefore, "position should be unclaimed");

    azuro.settleBet(tokenId, PAYOUT);

    uint256 railgunBalanceBefore = usdc.balanceOf(address(railgun));
    uint256 payout = adapter.redeemWin(tokenId);
    uint256 railgunBalanceAfter = usdc.balanceOf(address(railgun));

    require(payout == PAYOUT, "payout mismatch");
    require(railgunBalanceAfter == railgunBalanceBefore + PAYOUT, "shielded payout mismatch");

    (, , , bool claimedAfter) = adapter.positions(tokenId);
    require(claimedAfter, "position should be claimed");
  }

  function testOnlyRailgunCanCallUnshieldCallback() public {
    bytes memory data = _betRequestData(1, 0, 1, keccak256("zk-owner-2"));
    (bool ok, ) = address(adapter).call(
      abi.encodeWithSelector(
        adapter.onRailgunUnshield.selector,
        address(usdc),
        STAKE,
        data
      )
    );
    require(!ok, "expected callback access control revert");
  }

  function testRedeemRevertsWhenNotSettled() public {
    bytes memory data = _betRequestData(202, 2, 100, keccak256("zk-owner-3"));
    uint256 tokenId = railgun.unshieldToAdapter(address(usdc), STAKE, data);

    (bool ok, ) = address(adapter).call(abi.encodeWithSelector(adapter.redeemWin.selector, tokenId));
    require(!ok, "expected redeem revert before settlement");
  }

  function _betRequestData(
    uint256 marketId,
    uint8 outcome,
    uint256 minOdds,
    bytes32 zkOwnerHash
  ) internal pure returns (bytes memory) {
    PrivateBetAdapter.BetRequest memory request = PrivateBetAdapter.BetRequest({
      marketId: marketId,
      outcome: outcome,
      minOdds: minOdds,
      zkOwnerHash: zkOwnerHash
    });
    return abi.encode(request);
  }
}

