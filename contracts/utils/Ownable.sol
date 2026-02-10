// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Ownable {
  address public owner;

  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

  modifier onlyOwner() {
    require(msg.sender == owner, "Ownable: caller is not owner");
    _;
  }

  constructor() {
    owner = msg.sender;
    emit OwnershipTransferred(address(0), msg.sender);
  }

  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Ownable: zero owner");
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
  }
}
