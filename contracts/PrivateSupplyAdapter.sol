// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Ownable} from "./utils/Ownable.sol";
import {UserVault} from "./UserVault.sol";
import {VaultFactory} from "./VaultFactory.sol";

contract PrivateSupplyAdapter is Ownable {
  uint256 private constant VARIABLE_INTEREST_RATE_MODE = 2;

  struct SupplyRequest {
    bytes32 zkOwnerHash;
    bytes32 withdrawAuthHash;
  }

  struct SupplyPosition {
    bytes32 zkOwnerHash;
    address vault;
    address token;
    uint256 amount;
    bytes32 withdrawAuthHash;
  }

  address public privacyExecutor;
  address public supplyToken;
  IAavePool public aavePool;
  VaultFactory public vaultFactory;
  uint256 public nextPositionId;
  mapping(address => bool) private borrowTokenAllowedMap;

  mapping(uint256 => SupplyPosition) public positions;
  mapping(bytes32 => uint256[]) private ownerPositionIds;

  event PrivacyExecutorUpdated(address indexed executor);
  event SupplyTokenUpdated(address indexed token);
  event AavePoolUpdated(address indexed pool);
  event VaultFactoryUpdated(address indexed factory);
  event BorrowTokenUpdated(address indexed token, bool allowed);
  event PrivateSupplyDeposited(
    uint256 indexed positionId,
    bytes32 indexed zkOwnerHash,
    address indexed vault,
    address token,
    uint256 amount,
    bytes32 withdrawAuthHash
  );
  event PrivateSupplyWithdrawn(
    uint256 indexed positionId,
    bytes32 indexed zkOwnerHash,
    address indexed vault,
    address token,
    uint256 amount,
    address recipient,
    bytes32 nextWithdrawAuthHash
  );
  event PrivateBorrowed(
    uint256 indexed positionId,
    bytes32 indexed zkOwnerHash,
    address indexed vault,
    address debtToken,
    uint256 amount,
    address recipient,
    bytes32 nextWithdrawAuthHash
  );
  event PrivateRepaid(
    uint256 indexed positionId,
    bytes32 indexed zkOwnerHash,
    address indexed vault,
    address debtToken,
    uint256 amount,
    bytes32 nextWithdrawAuthHash
  );

  modifier onlyPrivacyExecutor() {
    require(msg.sender == privacyExecutor, "SupplyAdapter: only privacy executor");
    _;
  }

  constructor(
    address privacyExecutor_,
    address aavePool_,
    address supplyToken_,
    address vaultFactory_
  ) {
    require(privacyExecutor_ != address(0), "SupplyAdapter: zero executor");
    require(aavePool_ != address(0), "SupplyAdapter: zero pool");
    require(supplyToken_ != address(0), "SupplyAdapter: zero token");
    require(vaultFactory_ != address(0), "SupplyAdapter: zero factory");

    privacyExecutor = privacyExecutor_;
    aavePool = IAavePool(aavePool_);
    supplyToken = supplyToken_;
    vaultFactory = VaultFactory(vaultFactory_);
  }

  function setPrivacyExecutor(address executor) external onlyOwner {
    require(executor != address(0), "SupplyAdapter: zero executor");
    privacyExecutor = executor;
    emit PrivacyExecutorUpdated(executor);
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

  function setVaultFactory(address factory) external onlyOwner {
    require(factory != address(0), "SupplyAdapter: zero factory");
    vaultFactory = VaultFactory(factory);
    emit VaultFactoryUpdated(factory);
  }

  function setBorrowTokenAllowed(address token, bool allowed) external onlyOwner {
    require(token != address(0), "SupplyAdapter: zero borrow token");
    borrowTokenAllowedMap[token] = allowed;
    emit BorrowTokenUpdated(token, allowed);
  }

  function isBorrowTokenAllowed(address token) external view returns (bool) {
    return borrowTokenAllowedMap[token];
  }

  function onPrivateDeposit(
    address token,
    uint256 amount,
    bytes calldata data
  ) external onlyPrivacyExecutor returns (uint256 positionId) {
    require(token == supplyToken, "SupplyAdapter: unsupported token");
    require(amount > 0, "SupplyAdapter: zero amount");

    SupplyRequest memory request = abi.decode(data, (SupplyRequest));
    require(request.zkOwnerHash != bytes32(0), "SupplyAdapter: zero owner");
    require(request.withdrawAuthHash != bytes32(0), "SupplyAdapter: zero withdraw auth");

    address vault = vaultFactory.getOrCreateVault(request.zkOwnerHash);
    require(IERC20(token).transfer(vault, amount), "SupplyAdapter: transfer to vault failed");
    UserVault(vault).supply(token, address(aavePool), amount);

    positionId = ++nextPositionId;
    positions[positionId] = SupplyPosition({
      zkOwnerHash: request.zkOwnerHash,
      vault: vault,
      token: token,
      amount: amount,
      withdrawAuthHash: request.withdrawAuthHash
    });
    ownerPositionIds[request.zkOwnerHash].push(positionId);

    emit PrivateSupplyDeposited(positionId, request.zkOwnerHash, vault, token, amount, request.withdrawAuthHash);
  }

  function withdrawToRecipient(
    uint256 positionId,
    uint256 amount,
    bytes32 withdrawAuthSecret,
    bytes32 nextWithdrawAuthHash,
    address recipient
  ) external onlyPrivacyExecutor returns (uint256 withdrawnAmount) {
    require(recipient != address(0), "SupplyAdapter: zero recipient");

    SupplyPosition storage position = _loadAndValidatePosition(positionId);
    _validateAuth(position, withdrawAuthSecret);

    if (amount == type(uint256).max) {
      amount = position.amount;
    }
    require(amount > 0, "SupplyAdapter: zero amount");
    require(amount <= position.amount, "SupplyAdapter: amount exceeds position");

    withdrawnAmount = UserVault(position.vault).withdrawTo(position.token, address(aavePool), amount, recipient);
    require(withdrawnAmount > 0, "SupplyAdapter: zero withdrawn");

    require(withdrawnAmount <= amount, "SupplyAdapter: invalid withdrawn amount");
    position.amount -= withdrawnAmount;

    if (position.amount > 0) {
      require(nextWithdrawAuthHash != bytes32(0), "SupplyAdapter: zero next withdraw auth");
    }
    position.withdrawAuthHash = nextWithdrawAuthHash;

    emit PrivateSupplyWithdrawn(
      positionId,
      position.zkOwnerHash,
      position.vault,
      position.token,
      withdrawnAmount,
      recipient,
      nextWithdrawAuthHash
    );
  }

  function borrowToRecipient(
    uint256 positionId,
    address debtToken,
    uint256 amount,
    bytes32 authSecret,
    bytes32 nextAuthHash,
    address recipient
  ) external onlyPrivacyExecutor returns (uint256 borrowedAmount) {
    require(recipient != address(0), "SupplyAdapter: zero recipient");
    require(amount > 0, "SupplyAdapter: zero amount");
    require(debtToken != address(0), "SupplyAdapter: zero debt token");
    require(borrowTokenAllowedMap[debtToken], "SupplyAdapter: unsupported borrow token");

    SupplyPosition storage position = _loadAndValidatePosition(positionId);
    _validateAuth(position, authSecret);
    require(nextAuthHash != bytes32(0), "SupplyAdapter: zero next withdraw auth");

    UserVault(position.vault).borrowTo(debtToken, address(aavePool), amount, recipient, VARIABLE_INTEREST_RATE_MODE);
    borrowedAmount = amount;
    position.withdrawAuthHash = nextAuthHash;

    emit PrivateBorrowed(
      positionId,
      position.zkOwnerHash,
      position.vault,
      debtToken,
      borrowedAmount,
      recipient,
      nextAuthHash
    );
  }

  function repayFromPrivate(
    uint256 positionId,
    address debtToken,
    uint256 amount,
    bytes32 authSecret,
    bytes32 nextAuthHash
  ) external onlyPrivacyExecutor returns (uint256 repaidAmount) {
    require(amount > 0, "SupplyAdapter: zero amount");
    require(debtToken != address(0), "SupplyAdapter: zero debt token");
    require(borrowTokenAllowedMap[debtToken], "SupplyAdapter: unsupported borrow token");

    SupplyPosition storage position = _loadAndValidatePosition(positionId);
    _validateAuth(position, authSecret);
    require(nextAuthHash != bytes32(0), "SupplyAdapter: zero next withdraw auth");

    require(IERC20(debtToken).transfer(position.vault, amount), "SupplyAdapter: transfer to vault failed");
    repaidAmount = UserVault(position.vault).repayFromVaultBalance(
      debtToken,
      address(aavePool),
      amount,
      VARIABLE_INTEREST_RATE_MODE
    );
    require(repaidAmount > 0, "SupplyAdapter: zero repaid");

    position.withdrawAuthHash = nextAuthHash;

    emit PrivateRepaid(positionId, position.zkOwnerHash, position.vault, debtToken, repaidAmount, nextAuthHash);
  }

  function getPositionAccountData(
    uint256 positionId
  )
    external
    view
    returns (
      uint256 totalCollateralBase,
      uint256 totalDebtBase,
      uint256 availableBorrowsBase,
      uint256 currentLiquidationThreshold,
      uint256 ltv,
      uint256 healthFactor
    )
  {
    SupplyPosition storage position = positions[positionId];
    require(position.vault != address(0), "SupplyAdapter: invalid position");
    return aavePool.getUserAccountData(position.vault);
  }

  function getOwnerPositionIds(
    bytes32 zkOwnerHash,
    uint256 offset,
    uint256 limit
  ) external view returns (uint256[] memory ids, uint256 total) {
    uint256[] storage all = ownerPositionIds[zkOwnerHash];
    total = all.length;

    if (offset >= total || limit == 0) {
      return (new uint256[](0), total);
    }

    uint256 end = offset + limit;
    if (end > total) {
      end = total;
    }

    uint256 length = end - offset;
    ids = new uint256[](length);
    for (uint256 i = 0; i < length; i++) {
      ids[i] = all[offset + i];
    }
  }

  function _loadAndValidatePosition(uint256 positionId) internal view returns (SupplyPosition storage position) {
    position = positions[positionId];
    require(position.vault != address(0), "SupplyAdapter: invalid position");
    require(position.amount > 0, "SupplyAdapter: empty position");
  }

  function _validateAuth(SupplyPosition storage position, bytes32 authSecret) internal view {
    require(authSecret != bytes32(0), "SupplyAdapter: zero withdraw secret");
    require(keccak256(abi.encodePacked(authSecret)) == position.withdrawAuthHash, "SupplyAdapter: invalid withdraw auth");
  }
}
