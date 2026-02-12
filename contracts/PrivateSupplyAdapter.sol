// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IRailgunShield} from "./interfaces/IRailgunShield.sol";
import {Ownable} from "./utils/Ownable.sol";
import {UserVault} from "./UserVault.sol";
import {VaultFactory} from "./VaultFactory.sol";

contract PrivateSupplyAdapter is Ownable {
  struct SupplyRequest {
    bytes32 zkOwnerHash;
  }

  struct SupplyPosition {
    bytes32 zkOwnerHash;
    address vault;
    address token;
    uint256 amount;
  }

  address public railgunCallbackSender;
  address public supplyToken;
  IAavePool public aavePool;
  IRailgunShield public railgunShield;
  VaultFactory public vaultFactory;
  uint256 public nextPositionId;

  mapping(uint256 => SupplyPosition) public positions;

  event RailgunCallbackSenderUpdated(address indexed sender);
  event SupplyTokenUpdated(address indexed token);
  event AavePoolUpdated(address indexed pool);
  event RailgunShieldUpdated(address indexed railgunShield);
  event VaultFactoryUpdated(address indexed factory);
  event PrivateSupplyDeposited(
    uint256 indexed positionId,
    bytes32 indexed zkOwnerHash,
    address indexed vault,
    address token,
    uint256 amount
  );
  event PrivateSupplyWithdrawn(
    uint256 indexed positionId,
    bytes32 indexed zkOwnerHash,
    address indexed vault,
    address token,
    uint256 amount,
    bytes32 shieldToZkAddressHash
  );

  modifier onlyRailgunCallback() {
    require(msg.sender == railgunCallbackSender, "SupplyAdapter: only railgun callback");
    _;
  }

  constructor(
    address railgunCallbackSender_,
    address railgunShield_,
    address aavePool_,
    address supplyToken_,
    address vaultFactory_
  ) {
    require(railgunCallbackSender_ != address(0), "SupplyAdapter: zero callback");
    require(railgunShield_ != address(0), "SupplyAdapter: zero shield");
    require(aavePool_ != address(0), "SupplyAdapter: zero pool");
    require(supplyToken_ != address(0), "SupplyAdapter: zero token");
    require(vaultFactory_ != address(0), "SupplyAdapter: zero factory");

    railgunCallbackSender = railgunCallbackSender_;
    railgunShield = IRailgunShield(railgunShield_);
    aavePool = IAavePool(aavePool_);
    supplyToken = supplyToken_;
    vaultFactory = VaultFactory(vaultFactory_);
  }

  function setRailgunCallbackSender(address sender) external onlyOwner {
    require(sender != address(0), "SupplyAdapter: zero callback");
    railgunCallbackSender = sender;
    emit RailgunCallbackSenderUpdated(sender);
  }

  function setSupplyToken(address token) external onlyOwner {
    require(token != address(0), "SupplyAdapter: zero token");
    supplyToken = token;
    emit SupplyTokenUpdated(token);
  }

  function setAavePool(address pool) external onlyOwner {
    require(pool != address(0), "SupplyAdapter: zero pool");
    aavePool = IAavePool(pool);
    emit AavePoolUpdated(pool);
  }

  function setRailgunShield(address shield) external onlyOwner {
    require(shield != address(0), "SupplyAdapter: zero shield");
    railgunShield = IRailgunShield(shield);
    emit RailgunShieldUpdated(shield);
  }

  function setVaultFactory(address factory) external onlyOwner {
    require(factory != address(0), "SupplyAdapter: zero factory");
    vaultFactory = VaultFactory(factory);
    emit VaultFactoryUpdated(factory);
  }

  function onRailgunUnshield(
    address token,
    uint256 amount,
    bytes calldata data
  ) external onlyRailgunCallback returns (uint256 positionId) {
    require(token == supplyToken, "SupplyAdapter: unsupported token");
    require(amount > 0, "SupplyAdapter: zero amount");

    SupplyRequest memory request = abi.decode(data, (SupplyRequest));
    require(request.zkOwnerHash != bytes32(0), "SupplyAdapter: zero owner");

    address vault = vaultFactory.getOrCreateVault(request.zkOwnerHash);
    require(IERC20(token).transfer(vault, amount), "SupplyAdapter: transfer to vault failed");
    UserVault(vault).supply(token, address(aavePool), amount);

    positionId = ++nextPositionId;
    positions[positionId] = SupplyPosition({
      zkOwnerHash: request.zkOwnerHash,
      vault: vault,
      token: token,
      amount: amount
    });

    emit PrivateSupplyDeposited(positionId, request.zkOwnerHash, vault, token, amount);
  }

  function withdrawAndShield(
    uint256 positionId,
    uint256 amount,
    bytes32 shieldToZkAddressHash
  ) external onlyOwner returns (uint256 withdrawnAmount) {
    require(shieldToZkAddressHash != bytes32(0), "SupplyAdapter: zero shield receiver");

    SupplyPosition storage position = positions[positionId];
    require(position.vault != address(0), "SupplyAdapter: invalid position");
    require(position.amount > 0, "SupplyAdapter: empty position");

    if (amount == type(uint256).max) {
      amount = position.amount;
    }
    require(amount > 0, "SupplyAdapter: zero amount");
    require(amount <= position.amount, "SupplyAdapter: amount exceeds position");

    withdrawnAmount = UserVault(position.vault).withdrawToAdapter(position.token, address(aavePool), amount);
    require(withdrawnAmount > 0, "SupplyAdapter: zero withdrawn");

    // Defensive: Aave should not withdraw more than requested.
    require(withdrawnAmount <= amount, "SupplyAdapter: invalid withdrawn amount");
    position.amount -= withdrawnAmount;

    require(IERC20(position.token).approve(address(railgunShield), 0), "SupplyAdapter: reset approve failed");
    require(
      IERC20(position.token).approve(address(railgunShield), withdrawnAmount),
      "SupplyAdapter: approve failed"
    );
    railgunShield.shield(position.token, withdrawnAmount, shieldToZkAddressHash);

    emit PrivateSupplyWithdrawn(
      positionId,
      position.zkOwnerHash,
      position.vault,
      position.token,
      withdrawnAmount,
      shieldToZkAddressHash
    );
  }
}
