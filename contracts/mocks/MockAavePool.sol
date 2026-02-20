// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAavePool} from "../interfaces/IAavePool.sol";
import {IERC20} from "../interfaces/IERC20.sol";

contract MockAavePool is IAavePool {
  mapping(address => mapping(address => uint256)) public suppliedBalance;
  mapping(address => mapping(address => uint256)) public variableDebt;
  mapping(address => uint256) public totalCollateralBase;
  mapping(address => uint256) public totalDebtBase;

  event Supplied(address indexed asset, uint256 amount, address indexed onBehalfOf, address indexed from);
  event Withdrawn(address indexed asset, uint256 amount, address indexed fromVault, address indexed to);
  event Borrowed(address indexed asset, uint256 amount, address indexed onBehalfOf, address indexed borrower);
  event Repaid(address indexed asset, uint256 amount, address indexed onBehalfOf, address indexed repayer);

  function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
    require(asset != address(0), "MockAavePool: zero asset");
    require(amount > 0, "MockAavePool: zero amount");
    require(onBehalfOf != address(0), "MockAavePool: zero onBehalfOf");

    require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "MockAavePool: transfer failed");
    suppliedBalance[onBehalfOf][asset] += amount;
    totalCollateralBase[onBehalfOf] += amount;

    emit Supplied(asset, amount, onBehalfOf, msg.sender);
  }

  function withdraw(address asset, uint256 amount, address to) external returns (uint256 withdrawn) {
    require(asset != address(0), "MockAavePool: zero asset");
    require(to != address(0), "MockAavePool: zero to");

    uint256 current = suppliedBalance[msg.sender][asset];
    withdrawn = amount;
    if (withdrawn == type(uint256).max) {
      withdrawn = current;
    }
    require(withdrawn > 0 && withdrawn <= current, "MockAavePool: bad amount");

    suppliedBalance[msg.sender][asset] = current - withdrawn;
    totalCollateralBase[msg.sender] -= withdrawn;
    require(IERC20(asset).transfer(to, withdrawn), "MockAavePool: transfer out failed");
    emit Withdrawn(asset, withdrawn, msg.sender, to);
  }

  function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16, address onBehalfOf) external {
    require(asset != address(0), "MockAavePool: zero asset");
    require(amount > 0, "MockAavePool: zero amount");
    require(onBehalfOf != address(0), "MockAavePool: zero onBehalfOf");
    require(interestRateMode == 2, "MockAavePool: unsupported rate mode");
    require(totalCollateralBase[onBehalfOf] >= totalDebtBase[onBehalfOf] + amount, "MockAavePool: insufficient collateral");
    require(IERC20(asset).balanceOf(address(this)) >= amount, "MockAavePool: insufficient liquidity");

    variableDebt[onBehalfOf][asset] += amount;
    totalDebtBase[onBehalfOf] += amount;
    require(IERC20(asset).transfer(msg.sender, amount), "MockAavePool: transfer out failed");
    emit Borrowed(asset, amount, onBehalfOf, msg.sender);
  }

  function repay(
    address asset,
    uint256 amount,
    uint256 interestRateMode,
    address onBehalfOf
  ) external returns (uint256 repaid) {
    require(asset != address(0), "MockAavePool: zero asset");
    require(onBehalfOf != address(0), "MockAavePool: zero onBehalfOf");
    require(interestRateMode == 2, "MockAavePool: unsupported rate mode");
    require(amount > 0, "MockAavePool: zero amount");

    uint256 currentDebt = variableDebt[onBehalfOf][asset];
    require(currentDebt > 0, "MockAavePool: no debt");
    repaid = amount == type(uint256).max || amount >= currentDebt ? currentDebt : amount;

    require(IERC20(asset).transferFrom(msg.sender, address(this), repaid), "MockAavePool: transfer failed");
    variableDebt[onBehalfOf][asset] = currentDebt - repaid;
    totalDebtBase[onBehalfOf] -= repaid;

    emit Repaid(asset, repaid, onBehalfOf, msg.sender);
  }

  function getUserAccountData(
    address user
  )
    external
    view
    returns (
      uint256 totalCollateral,
      uint256 totalDebt,
      uint256 availableBorrows,
      uint256 currentLiquidationThreshold,
      uint256 ltv,
      uint256 healthFactor
    )
  {
    totalCollateral = totalCollateralBase[user];
    totalDebt = totalDebtBase[user];
    availableBorrows = totalCollateral > totalDebt ? totalCollateral - totalDebt : 0;
    currentLiquidationThreshold = 8_500;
    ltv = 8_000;
    if (totalDebt == 0) {
      healthFactor = type(uint256).max;
    } else {
      healthFactor = (totalCollateral * 1e18) / totalDebt;
    }
  }
}
