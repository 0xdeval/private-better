// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20} from "./interfaces/IERC20.sol";

contract UserVault {
  address public immutable adapter;

  modifier onlyAdapter() {
    require(msg.sender == adapter, "UserVault: only adapter");
    _;
  }

  constructor(address adapter_) {
    require(adapter_ != address(0), "UserVault: zero adapter");
    adapter = adapter_;
  }

  function supply(address token, address aavePool, uint256 amount) external onlyAdapter {
    require(token != address(0), "UserVault: zero token");
    require(aavePool != address(0), "UserVault: zero pool");
    require(amount > 0, "UserVault: zero amount");

    require(IERC20(token).approve(aavePool, 0), "UserVault: reset approve failed");
    require(IERC20(token).approve(aavePool, amount), "UserVault: approve failed");
    IAavePool(aavePool).supply(token, amount, address(this), 0);
  }

  function withdrawTo(
    address token,
    address aavePool,
    uint256 amount,
    address recipient
  ) external onlyAdapter returns (uint256) {
    require(token != address(0), "UserVault: zero token");
    require(aavePool != address(0), "UserVault: zero pool");
    require(recipient != address(0), "UserVault: zero recipient");
    return IAavePool(aavePool).withdraw(token, amount, recipient);
  }
}
