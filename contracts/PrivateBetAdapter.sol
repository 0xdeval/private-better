// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAzuro} from "./interfaces/IAzuro.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IRailgunShield} from "./interfaces/IRailgunShield.sol";
import {Ownable} from "./utils/Ownable.sol";

contract PrivateBetAdapter is Ownable {
  struct BetRequest {
    uint256 marketId;
    uint8 outcome;
    uint256 minOdds;
    bytes32 zkOwnerHash;
  }

  struct BetPosition {
    bytes32 zkOwnerHash;
    address token;
    uint256 stake;
    bool claimed;
  }

  address public railgunCallbackSender;
  address public usdc;
  IAzuro public azuro;
  IRailgunShield public railgunShield;

  mapping(uint256 => BetPosition) public positions;

  event RailgunCallbackSenderUpdated(address indexed sender);
  event AzuroUpdated(address indexed azuro);
  event RailgunShieldUpdated(address indexed railgunShield);
  event UsdcUpdated(address indexed usdc);
  event PrivateBetPlaced(
    uint256 indexed betTokenId,
    bytes32 indexed zkOwnerHash,
    uint256 marketId,
    uint8 outcome,
    uint256 amount
  );
  event PrivateWinRedeemed(uint256 indexed betTokenId, bytes32 indexed zkOwnerHash, uint256 payoutAmount);

  modifier onlyRailgunCallback() {
    require(msg.sender == railgunCallbackSender, "Adapter: only railgun callback");
    _;
  }

  constructor(address railgunCallbackSender_, address railgunShield_, address azuro_, address usdc_) {
    require(railgunCallbackSender_ != address(0), "Adapter: zero callback sender");
    require(railgunShield_ != address(0), "Adapter: zero railgun shield");
    require(azuro_ != address(0), "Adapter: zero azuro");
    require(usdc_ != address(0), "Adapter: zero usdc");
    railgunCallbackSender = railgunCallbackSender_;
    railgunShield = IRailgunShield(railgunShield_);
    azuro = IAzuro(azuro_);
    usdc = usdc_;
  }

  function setRailgunCallbackSender(address sender) external onlyOwner {
    require(sender != address(0), "Adapter: zero callback sender");
    railgunCallbackSender = sender;
    emit RailgunCallbackSenderUpdated(sender);
  }

  function setAzuro(address azuro_) external onlyOwner {
    require(azuro_ != address(0), "Adapter: zero azuro");
    azuro = IAzuro(azuro_);
    emit AzuroUpdated(azuro_);
  }

  function setRailgunShield(address railgunShield_) external onlyOwner {
    require(railgunShield_ != address(0), "Adapter: zero railgun shield");
    railgunShield = IRailgunShield(railgunShield_);
    emit RailgunShieldUpdated(railgunShield_);
  }

  function setUsdc(address usdc_) external onlyOwner {
    require(usdc_ != address(0), "Adapter: zero usdc");
    usdc = usdc_;
    emit UsdcUpdated(usdc_);
  }

  function onRailgunUnshield(
    address token,
    uint256 amount,
    bytes calldata data
  ) external onlyRailgunCallback returns (uint256 betTokenId) {
    require(token == usdc, "Adapter: unsupported token");
    require(amount > 0, "Adapter: zero amount");

    BetRequest memory request = abi.decode(data, (BetRequest));
    require(request.zkOwnerHash != bytes32(0), "Adapter: zero zk owner");

    _approveExact(IERC20(token), address(azuro), amount);
    betTokenId = azuro.placeBet(token, request.marketId, request.outcome, amount, request.minOdds);
    require(positions[betTokenId].zkOwnerHash == bytes32(0), "Adapter: duplicate token id");

    positions[betTokenId] = BetPosition({
      zkOwnerHash: request.zkOwnerHash,
      token: token,
      stake: amount,
      claimed: false
    });

    emit PrivateBetPlaced(betTokenId, request.zkOwnerHash, request.marketId, request.outcome, amount);
  }

  function redeemWin(uint256 betTokenId) external returns (uint256 payoutAmount) {
    BetPosition storage position = positions[betTokenId];
    require(position.zkOwnerHash != bytes32(0), "Adapter: unknown bet");
    require(!position.claimed, "Adapter: already claimed");
    require(azuro.isClaimable(betTokenId), "Adapter: not claimable");

    uint256 beforeBalance = IERC20(position.token).balanceOf(address(this));
    uint256 claimedByAzuro = azuro.claim(betTokenId);
    uint256 afterBalance = IERC20(position.token).balanceOf(address(this));

    payoutAmount = afterBalance - beforeBalance;
    if (claimedByAzuro > 0) {
      require(payoutAmount == claimedByAzuro, "Adapter: payout mismatch");
    }
    require(payoutAmount > 0, "Adapter: zero payout");

    position.claimed = true;
    _approveExact(IERC20(position.token), address(railgunShield), payoutAmount);
    railgunShield.shield(position.token, payoutAmount, position.zkOwnerHash);

    emit PrivateWinRedeemed(betTokenId, position.zkOwnerHash, payoutAmount);
  }

  function _approveExact(IERC20 token, address spender, uint256 amount) internal {
    require(token.approve(spender, 0), "Adapter: reset approve failed");
    require(token.approve(spender, amount), "Adapter: approve failed");
  }
}
