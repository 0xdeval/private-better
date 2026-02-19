// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20} from "./interfaces/IERC20.sol";

contract UserVault {
  uint256 private constant VARIABLE_INTEREST_RATE_MODE = 2;
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

  function borrowTo(
    address token,
    address aavePool,
    uint256 amount,
    address recipient,
    uint256 interestRateMode
  ) external onlyAdapter {
    require(token != address(0), "UserVault: zero token");
    require(aavePool != address(0), "UserVault: zero pool");
    require(recipient != address(0), "UserVault: zero recipient");
    require(amount > 0, "UserVault: zero amount");
    require(interestRateMode == VARIABLE_INTEREST_RATE_MODE, "UserVault: unsupported rate mode");

    IAavePool(aavePool).borrow(token, amount, interestRateMode, 0, address(this));
    require(IERC20(token).transfer(recipient, amount), "UserVault: transfer out failed");
  }

  function repayFromVaultBalance(
    address token,
    address aavePool,
    uint256 amount,
    uint256 interestRateMode
  ) external onlyAdapter returns (uint256) {
    require(token != address(0), "UserVault: zero token");
    require(aavePool != address(0), "UserVault: zero pool");
    require(amount > 0, "UserVault: zero amount");
    require(interestRateMode == VARIABLE_INTEREST_RATE_MODE, "UserVault: unsupported rate mode");

    require(IERC20(token).approve(aavePool, 0), "UserVault: reset approve failed");
    require(IERC20(token).approve(aavePool, amount), "UserVault: approve failed");
    return IAavePool(aavePool).repay(token, amount, interestRateMode, address(this));
  }
}
