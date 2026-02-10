// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";
import {IPrivateBetAdapter} from "../interfaces/IPrivateBetAdapter.sol";
import {IRailgunShield} from "../interfaces/IRailgunShield.sol";
import {Ownable} from "../utils/Ownable.sol";

contract MockRailgun is IRailgunShield, Ownable {
  IPrivateBetAdapter public adapter;

  event AdapterUpdated(address indexed adapter);
  event UnshieldToAdapter(
    address indexed token,
    uint256 amount,
    bytes data,
    uint256 indexed betTokenId
  );
  event ShieldedToPrivate(
    address indexed token,
    uint256 amount,
    bytes32 indexed zkAddressHash,
    address indexed from
  );

  function setAdapter(address adapter_) external onlyOwner {
    require(adapter_ != address(0), "MockRailgun: zero adapter");
    adapter = IPrivateBetAdapter(adapter_);
    emit AdapterUpdated(adapter_);
  }

  function depositToken(address token, uint256 amount) external onlyOwner {
    require(token != address(0), "MockRailgun: zero token");
    require(amount > 0, "MockRailgun: zero amount");
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "MockRailgun: transfer failed");
  }

  function unshieldToAdapter(
    address token,
    uint256 amount,
    bytes calldata data
  ) external onlyOwner returns (uint256 betTokenId) {
    require(address(adapter) != address(0), "MockRailgun: adapter not set");
    require(token != address(0), "MockRailgun: zero token");
    require(amount > 0, "MockRailgun: zero amount");

    require(IERC20(token).transfer(address(adapter), amount), "MockRailgun: unshield transfer failed");
    betTokenId = adapter.onRailgunUnshield(token, amount, data);
    emit UnshieldToAdapter(token, amount, data, betTokenId);
  }

  function shield(address token, uint256 amount, bytes32 zkAddressHash) external {
    require(token != address(0), "MockRailgun: zero token");
    require(amount > 0, "MockRailgun: zero amount");
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "MockRailgun: shield transfer failed");
    emit ShieldedToPrivate(token, amount, zkAddressHash, msg.sender);
  }
}
