// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrivateSupplyAdapter} from "../PrivateSupplyAdapter.sol";
import {VaultFactory} from "../VaultFactory.sol";
import {MockAavePool} from "../mocks/MockAavePool.sol";
import {MockRailgun} from "../mocks/MockRailgun.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract NonOwnerWithdrawCaller {
  function callWithdraw(
    address adapter,
    uint256 positionId,
    uint256 amount,
    bytes32 shieldToZkAddressHash
  ) external returns (bool ok) {
    (ok, ) = adapter.call(
      abi.encodeWithSignature(
        "withdrawAndShield(uint256,uint256,bytes32)",
        positionId,
        amount,
        shieldToZkAddressHash
      )
    );
  }
}

contract PrivateSupplyAdapterTest {
  MockUSDC internal usdc;
  MockAavePool internal aavePool;
  MockRailgun internal railgun;
  VaultFactory internal factory;
  PrivateSupplyAdapter internal adapter;
  NonOwnerWithdrawCaller internal nonOwnerCaller;

  uint256 internal constant USDC_1 = 1_000_000;
  uint256 internal constant STAKE = 100 * USDC_1;

  function setUp() public {
    usdc = new MockUSDC();
    aavePool = new MockAavePool();
    railgun = new MockRailgun();
    factory = new VaultFactory();
    adapter = new PrivateSupplyAdapter(
      address(railgun),
      address(railgun),
      address(aavePool),
      address(usdc),
      address(factory)
    );
    nonOwnerCaller = new NonOwnerWithdrawCaller();

    factory.setAdapter(address(adapter));
    railgun.setAdapter(address(adapter));

    usdc.mint(address(this), 2_000 * USDC_1);
    usdc.approve(address(railgun), type(uint256).max);
    railgun.depositToken(address(usdc), 600 * USDC_1);
  }

  function testUnshieldSupplyFlowCreatesVaultAndSuppliesToAave() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-1");
    bytes memory data = _supplyRequestData(zkOwnerHash);

    uint256 positionId = railgun.unshieldToAdapter(address(usdc), STAKE, data);
    require(positionId == 1, "expected position id 1");

    (bytes32 ownerHash, address vault, address token, uint256 amount) = adapter.positions(positionId);
    require(ownerHash == zkOwnerHash, "owner hash mismatch");
    require(vault != address(0), "vault not created");
    require(token == address(usdc), "token mismatch");
    require(amount == STAKE, "amount mismatch");

    uint256 supplied = aavePool.suppliedBalance(vault, address(usdc));
    require(supplied == STAKE, "aave supplied balance mismatch");
  }

  function testOnlyRailgunCanCallUnshieldCallback() public {
    bytes memory data = _supplyRequestData(keccak256("zk-owner-2"));
    (bool ok, ) = address(adapter).call(
      abi.encodeWithSelector(adapter.onRailgunUnshield.selector, address(usdc), STAKE, data)
    );
    require(!ok, "expected callback access control revert");
  }

  function testWithdrawAndShieldFullFlow() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-3");
    bytes32 shieldToZkAddressHash = keccak256("zk-shield-recipient-3");
    bytes memory data = _supplyRequestData(zkOwnerHash);

    uint256 positionId = railgun.unshieldToAdapter(address(usdc), STAKE, data);
    uint256 withdrawn = adapter.withdrawAndShield(positionId, type(uint256).max, shieldToZkAddressHash);
    require(withdrawn == STAKE, "withdrawn amount mismatch");

    (bytes32 ownerHash, address vault, address token, uint256 amount) = adapter.positions(positionId);
    require(ownerHash == zkOwnerHash, "owner hash mismatch");
    require(vault != address(0), "vault missing");
    require(token == address(usdc), "token mismatch");
    require(amount == 0, "position amount should be zero");

    uint256 supplied = aavePool.suppliedBalance(vault, address(usdc));
    require(supplied == 0, "aave supplied should be zero");

    uint256 railgunBalance = usdc.balanceOf(address(railgun));
    require(railgunBalance == 600 * USDC_1, "railgun balance should be restored");
  }

  function testOnlyOwnerCanWithdrawAndShield() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-4");
    bytes memory data = _supplyRequestData(zkOwnerHash);
    uint256 positionId = railgun.unshieldToAdapter(address(usdc), STAKE, data);

    bool ok = nonOwnerCaller.callWithdraw(
      address(adapter),
      positionId,
      STAKE,
      keccak256("zk-shield-recipient-4")
    );
    require(!ok, "non-owner withdraw should fail");
  }

  function testWithdrawRevertsWhenAmountExceedsPosition() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-5");
    bytes memory data = _supplyRequestData(zkOwnerHash);
    uint256 positionId = railgun.unshieldToAdapter(address(usdc), STAKE, data);

    (bool ok, ) = address(adapter).call(
      abi.encodeWithSignature(
        "withdrawAndShield(uint256,uint256,bytes32)",
        positionId,
        STAKE + 1,
        keccak256("zk-shield-recipient-5")
      )
    );
    require(!ok, "withdraw above position amount should fail");
  }

  function _supplyRequestData(bytes32 zkOwnerHash) internal pure returns (bytes memory) {
    PrivateSupplyAdapter.SupplyRequest memory request = PrivateSupplyAdapter.SupplyRequest({zkOwnerHash: zkOwnerHash});
    return abi.encode(request);
  }
}
