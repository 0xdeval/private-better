// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";
import {IPrivateSupplyAdapter} from "../interfaces/IPrivateSupplyAdapter.sol";
import {Ownable} from "../utils/Ownable.sol";

contract MockPrivacyExecutor is Ownable {
  IPrivateSupplyAdapter public adapter;

  event AdapterUpdated(address indexed adapter);
  event PrivateDeposit(address indexed token, uint256 amount, bytes data, uint256 indexed positionId);
  event PrivateWithdraw(
    uint256 indexed positionId,
    uint256 amount,
    bytes32 withdrawAuthSecret,
    bytes32 nextWithdrawAuthHash,
    address indexed recipient,
    uint256 withdrawnAmount
  );

  function setAdapter(address adapter_) external onlyOwner {
    require(adapter_ != address(0), "MockPrivacyExecutor: zero adapter");
    adapter = IPrivateSupplyAdapter(adapter_);
    emit AdapterUpdated(adapter_);
  }

  function depositToken(address token, uint256 amount) external onlyOwner {
    require(token != address(0), "MockPrivacyExecutor: zero token");
    require(amount > 0, "MockPrivacyExecutor: zero amount");
    require(
      IERC20(token).transferFrom(msg.sender, address(this), amount),
      "MockPrivacyExecutor: transfer failed"
    );
  }

  function executePrivateDeposit(
    address token,
    uint256 amount,
    bytes calldata data
  ) external onlyOwner returns (uint256 positionId) {
    require(address(adapter) != address(0), "MockPrivacyExecutor: adapter not set");
    require(token != address(0), "MockPrivacyExecutor: zero token");
    require(amount > 0, "MockPrivacyExecutor: zero amount");

    require(IERC20(token).transfer(address(adapter), amount), "MockPrivacyExecutor: transfer failed");
    positionId = adapter.onPrivateDeposit(token, amount, data);
    emit PrivateDeposit(token, amount, data, positionId);
  }

  function executePrivateWithdraw(
    uint256 positionId,
    uint256 amount,
    bytes32 withdrawAuthSecret,
    bytes32 nextWithdrawAuthHash,
    address recipient
  ) external onlyOwner returns (uint256 withdrawnAmount) {
    require(address(adapter) != address(0), "MockPrivacyExecutor: adapter not set");
    withdrawnAmount = adapter.withdrawToRecipient(
      positionId,
      amount,
      withdrawAuthSecret,
      nextWithdrawAuthHash,
      recipient
    );
    emit PrivateWithdraw(
      positionId,
      amount,
      withdrawAuthSecret,
      nextWithdrawAuthHash,
      recipient,
      withdrawnAmount
    );
  }
}
