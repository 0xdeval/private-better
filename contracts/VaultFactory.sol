// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "./utils/Ownable.sol";
import {UserVault} from "./UserVault.sol";

contract VaultFactory is Ownable {
  address public adapter;
  mapping(bytes32 => address) public vaultOfZkOwner;

  event AdapterUpdated(address indexed adapter);
  event VaultCreated(bytes32 indexed zkOwnerHash, address indexed vault);

  modifier onlyAdapter() {
    require(msg.sender == adapter, "VaultFactory: only adapter");
    _;
  }

  function setAdapter(address adapter_) external onlyOwner {
    require(adapter_ != address(0), "VaultFactory: zero adapter");
    adapter = adapter_;
    emit AdapterUpdated(adapter_);
  }

  function getOrCreateVault(bytes32 zkOwnerHash) external onlyAdapter returns (address vault) {
    require(zkOwnerHash != bytes32(0), "VaultFactory: zero owner hash");
    vault = vaultOfZkOwner[zkOwnerHash];
    if (vault == address(0)) {
      vault = address(new UserVault(adapter));
      vaultOfZkOwner[zkOwnerHash] = vault;
      emit VaultCreated(zkOwnerHash, vault);
    }
  }
}
