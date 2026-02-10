// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAzuro} from "../interfaces/IAzuro.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {Ownable} from "../utils/Ownable.sol";

contract MockAzuro is IAzuro, Ownable {
  struct Bet {
    address bettor;
    address token;
    uint256 marketId;
    uint8 outcome;
    uint256 amount;
    uint256 minOdds;
    uint256 payout;
    bool settled;
    bool claimed;
  }

  uint256 public nextTokenId;
  mapping(uint256 => Bet) public bets;

  event BetPlaced(
    uint256 indexed tokenId,
    address indexed bettor,
    address indexed token,
    uint256 marketId,
    uint8 outcome,
    uint256 amount,
    uint256 minOdds
  );
  event BetSettled(uint256 indexed tokenId, uint256 payout);
  event BetClaimed(uint256 indexed tokenId, address indexed bettor, uint256 payout);

  function placeBet(
    address token,
    uint256 marketId,
    uint8 outcome,
    uint256 amount,
    uint256 minOdds
  ) external returns (uint256 tokenId) {
    require(amount > 0, "MockAzuro: zero amount");
    require(token != address(0), "MockAzuro: zero token");

    tokenId = ++nextTokenId;
    bets[tokenId] = Bet({
      bettor: msg.sender,
      token: token,
      marketId: marketId,
      outcome: outcome,
      amount: amount,
      minOdds: minOdds,
      payout: 0,
      settled: false,
      claimed: false
    });

    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "MockAzuro: stake transfer failed");

    emit BetPlaced(tokenId, msg.sender, token, marketId, outcome, amount, minOdds);
  }

  function settleBet(uint256 tokenId, uint256 payout) external onlyOwner {
    Bet storage bet = bets[tokenId];
    require(bet.bettor != address(0), "MockAzuro: unknown bet");
    require(!bet.claimed, "MockAzuro: already claimed");
    bet.settled = true;
    bet.payout = payout;
    emit BetSettled(tokenId, payout);
  }

  function seedLiquidity(address token, uint256 amount) external onlyOwner {
    require(token != address(0), "MockAzuro: zero token");
    require(amount > 0, "MockAzuro: zero amount");
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "MockAzuro: transfer failed");
  }

  function isClaimable(uint256 tokenId) external view returns (bool) {
    Bet storage bet = bets[tokenId];
    return bet.settled && !bet.claimed && bet.payout > 0;
  }

  function getPayout(uint256 tokenId) external view returns (uint256) {
    Bet storage bet = bets[tokenId];
    if (!bet.settled || bet.claimed) return 0;
    return bet.payout;
  }

  function claim(uint256 tokenId) external returns (uint256 payoutAmount) {
    Bet storage bet = bets[tokenId];
    require(bet.bettor == msg.sender, "MockAzuro: not bettor");
    require(bet.settled, "MockAzuro: not settled");
    require(!bet.claimed, "MockAzuro: already claimed");

    payoutAmount = bet.payout;
    bet.claimed = true;
    if (payoutAmount > 0) {
      require(IERC20(bet.token).transfer(msg.sender, payoutAmount), "MockAzuro: payout transfer failed");
    }
    emit BetClaimed(tokenId, msg.sender, payoutAmount);
  }
}
