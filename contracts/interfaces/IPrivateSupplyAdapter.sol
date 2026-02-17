// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPrivateSupplyAdapter {
  function onPrivateDeposit(
    address token,
    uint256 amount,
    bytes calldata data
  ) external returns (uint256 positionId);

  function withdrawToRecipient(
    uint256 positionId,
    uint256 amount,
    bytes32 withdrawAuthSecret,
    bytes32 nextWithdrawAuthHash,
    address recipient
  ) external returns (uint256 withdrawnAmount);

  function getOwnerPositionIds(
    bytes32 zkOwnerHash,
    uint256 offset,
    uint256 limit
  ) external view returns (uint256[] memory ids, uint256 total);
}
