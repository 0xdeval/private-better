// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrivateSupplyAdapter} from "../PrivateSupplyAdapter.sol";
import {VaultFactory} from "../VaultFactory.sol";
import {MockAavePool} from "../mocks/MockAavePool.sol";
import {MockPrivacyExecutor} from "../mocks/MockRailgun.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract NonExecutorWithdrawCaller {
  function callWithdraw(
    address adapter,
    uint256 positionId,
    uint256 amount,
    bytes32 withdrawAuthSecret,
    bytes32 nextWithdrawAuthHash,
    address recipient
  ) external returns (bool ok) {
    (ok, ) = adapter.call(
      abi.encodeWithSignature(
        "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)",
        positionId,
        amount,
        withdrawAuthSecret,
        nextWithdrawAuthHash,
        recipient
      )
    );
  }
}

contract PrivateSupplyAdapterTest {
  MockUSDC internal usdc;
  MockAavePool internal aavePool;
  MockPrivacyExecutor internal executor;
  VaultFactory internal factory;
  PrivateSupplyAdapter internal adapter;
  NonExecutorWithdrawCaller internal nonExecutorCaller;

  uint256 internal constant USDC_1 = 1_000_000;
  uint256 internal constant STAKE = 100 * USDC_1;

  function setUp() public {
    usdc = new MockUSDC();
    aavePool = new MockAavePool();
    executor = new MockPrivacyExecutor();
    factory = new VaultFactory();
    adapter = new PrivateSupplyAdapter(address(executor), address(aavePool), address(usdc), address(factory));
    nonExecutorCaller = new NonExecutorWithdrawCaller();

    factory.setAdapter(address(adapter));
    executor.setAdapter(address(adapter));

    usdc.mint(address(this), 2_000 * USDC_1);
    usdc.approve(address(executor), type(uint256).max);
    executor.depositToken(address(usdc), 600 * USDC_1);
  }

  function testPrivateDepositFlowStoresWithdrawAuthAndOwnerIndex() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-1");
    bytes32 withdrawAuthSecret = keccak256("withdraw-secret-1");
    bytes32 withdrawAuthHash = keccak256(abi.encodePacked(withdrawAuthSecret));
    bytes memory data = _supplyRequestData(zkOwnerHash, withdrawAuthHash);

    uint256 positionId = executor.executePrivateDeposit(address(usdc), STAKE, data);
    require(positionId == 1, "expected position id 1");

    (bytes32 ownerHash, address vault, address token, uint256 amount, bytes32 storedWithdrawAuthHash) = adapter
      .positions(positionId);
    require(ownerHash == zkOwnerHash, "owner hash mismatch");
    require(vault != address(0), "vault not created");
    require(token == address(usdc), "token mismatch");
    require(amount == STAKE, "amount mismatch");
    require(storedWithdrawAuthHash == withdrawAuthHash, "withdraw auth hash mismatch");

    (uint256[] memory ownerIds, uint256 total) = adapter.getOwnerPositionIds(zkOwnerHash, 0, 10);
    require(total == 1, "owner position total mismatch");
    require(ownerIds.length == 1 && ownerIds[0] == positionId, "owner position id mismatch");

    uint256 supplied = aavePool.suppliedBalance(vault, address(usdc));
    require(supplied == STAKE, "aave supplied balance mismatch");
  }

  function testOnlyExecutorCanCallPrivateDeposit() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-2");
    bytes32 withdrawAuthHash = keccak256("withdraw-auth-2");
    bytes memory data = _supplyRequestData(zkOwnerHash, withdrawAuthHash);
    (bool ok, ) = address(adapter).call(
      abi.encodeWithSelector(adapter.onPrivateDeposit.selector, address(usdc), STAKE, data)
    );
    require(!ok, "expected executor access control revert");
  }

  function testWithdrawToRecipientFullFlowWithCorrectSecret() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-3");
    bytes32 withdrawAuthSecret = keccak256("withdraw-secret-3");
    bytes32 withdrawAuthHash = keccak256(abi.encodePacked(withdrawAuthSecret));
    bytes memory data = _supplyRequestData(zkOwnerHash, withdrawAuthHash);

    uint256 positionId = executor.executePrivateDeposit(address(usdc), STAKE, data);
    address recipient = address(0xBEEF);
    uint256 beforeRecipient = usdc.balanceOf(recipient);

    uint256 withdrawn = executor.executePrivateWithdraw(
      positionId,
      type(uint256).max,
      withdrawAuthSecret,
      bytes32(0),
      recipient
    );
    require(withdrawn == STAKE, "withdrawn amount mismatch");

    (bytes32 ownerHash, address vault, address token, uint256 amount, bytes32 nextWithdrawHash) = adapter.positions(
      positionId
    );
    require(ownerHash == zkOwnerHash, "owner hash mismatch");
    require(vault != address(0), "vault missing");
    require(token == address(usdc), "token mismatch");
    require(amount == 0, "position amount should be zero");
    require(nextWithdrawHash == bytes32(0), "next withdraw hash should be zero");

    uint256 supplied = aavePool.suppliedBalance(vault, address(usdc));
    require(supplied == 0, "aave supplied should be zero");

    uint256 afterRecipient = usdc.balanceOf(recipient);
    require(afterRecipient - beforeRecipient == STAKE, "recipient should receive withdrawn funds");
  }

  function testWithdrawRevertsForWrongSecret() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-4");
    bytes32 withdrawAuthSecret = keccak256("withdraw-secret-4");
    bytes32 withdrawAuthHash = keccak256(abi.encodePacked(withdrawAuthSecret));
    bytes memory data = _supplyRequestData(zkOwnerHash, withdrawAuthHash);
    uint256 positionId = executor.executePrivateDeposit(address(usdc), STAKE, data);

    bytes32 wrongSecret = keccak256("wrong-secret-4");
    (bool ok, ) = address(executor).call(
      abi.encodeWithSignature(
        "executePrivateWithdraw(uint256,uint256,bytes32,bytes32,address)",
        positionId,
        STAKE,
        wrongSecret,
        bytes32(0),
        address(this)
      )
    );
    require(!ok, "withdraw with wrong secret should fail");
  }

  function testOnlyExecutorCanWithdrawToRecipient() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-5");
    bytes32 withdrawAuthSecret = keccak256("withdraw-secret-5");
    bytes32 withdrawAuthHash = keccak256(abi.encodePacked(withdrawAuthSecret));
    bytes memory data = _supplyRequestData(zkOwnerHash, withdrawAuthHash);
    uint256 positionId = executor.executePrivateDeposit(address(usdc), STAKE, data);

    bool ok = nonExecutorCaller.callWithdraw(
      address(adapter),
      positionId,
      STAKE,
      withdrawAuthSecret,
      bytes32(0),
      address(this)
    );
    require(!ok, "non-executor withdraw should fail");
  }

  function testPartialWithdrawRotatesSecret() public {
    bytes32 zkOwnerHash = keccak256("zk-owner-6");
    bytes32 withdrawAuthSecret = keccak256("withdraw-secret-6");
    bytes32 withdrawAuthHash = keccak256(abi.encodePacked(withdrawAuthSecret));
    bytes memory data = _supplyRequestData(zkOwnerHash, withdrawAuthHash);
    uint256 positionId = executor.executePrivateDeposit(address(usdc), STAKE, data);

    uint256 partialAmount = 40 * USDC_1;
    bytes32 nextSecret = keccak256("withdraw-secret-6-next");
    bytes32 nextHash = keccak256(abi.encodePacked(nextSecret));

    uint256 withdrawn = executor.executePrivateWithdraw(
      positionId,
      partialAmount,
      withdrawAuthSecret,
      nextHash,
      address(this)
    );
    require(withdrawn == partialAmount, "partial withdrawn mismatch");

    (, , , uint256 remainingAmount, bytes32 storedNextHash) = adapter.positions(positionId);
    require(remainingAmount == STAKE - partialAmount, "remaining amount mismatch");
    require(storedNextHash == nextHash, "next hash not stored");

    (bool okOld, ) = address(executor).call(
      abi.encodeWithSignature(
        "executePrivateWithdraw(uint256,uint256,bytes32,bytes32,address)",
        positionId,
        1,
        withdrawAuthSecret,
        keccak256("another-next-hash"),
        address(this)
      )
    );
    require(!okOld, "old secret should fail after rotation");

    (bool okNew, ) = address(executor).call(
      abi.encodeWithSignature(
        "executePrivateWithdraw(uint256,uint256,bytes32,bytes32,address)",
        positionId,
        type(uint256).max,
        nextSecret,
        bytes32(0),
        address(this)
      )
    );
    require(okNew, "new secret should pass");
  }

  function _supplyRequestData(bytes32 zkOwnerHash, bytes32 withdrawAuthHash) internal pure returns (bytes memory) {
    PrivateSupplyAdapter.SupplyRequest memory request = PrivateSupplyAdapter.SupplyRequest({
      zkOwnerHash: zkOwnerHash,
      withdrawAuthHash: withdrawAuthHash
    });
    return abi.encode(request);
  }
}
