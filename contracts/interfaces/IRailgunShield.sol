// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRailgunShield {
  function shield(address token, uint256 amount, bytes32 zkAddressHash) external;
}
