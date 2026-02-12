// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAavePool} from "../interfaces/IAavePool.sol";
import {IERC20} from "../interfaces/IERC20.sol";

contract MockAavePool is IAavePool {
  mapping(address => mapping(address => uint256)) public suppliedBalance;

  event Supplied(address indexed asset, uint256 amount, address indexed onBehalfOf, address indexed from);
  event Withdrawn(address indexed asset, uint256 amount, address indexed fromVault, address indexed to);

  function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
    require(asset != address(0), "MockAavePool: zero asset");
    require(amount > 0, "MockAavePool: zero amount");
    require(onBehalfOf != address(0), "MockAavePool: zero onBehalfOf");

    require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "MockAavePool: transfer failed");
    suppliedBalance[onBehalfOf][asset] += amount;

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
    require(IERC20(asset).transfer(to, withdrawn), "MockAavePool: transfer out failed");
    emit Withdrawn(asset, withdrawn, msg.sender, to);
  }
}
