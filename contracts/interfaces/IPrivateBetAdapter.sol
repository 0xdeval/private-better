// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPrivateBetAdapter {
  function onRailgunUnshield(
    address token,
    uint256 amount,
    bytes calldata data
  ) external returns (uint256 betTokenId);
}
