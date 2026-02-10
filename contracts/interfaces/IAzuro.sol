// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAzuro {
  function placeBet(
    address token,
    uint256 marketId,
    uint8 outcome,
    uint256 amount,
    uint256 minOdds
  ) external returns (uint256 tokenId);

  function claim(uint256 tokenId) external returns (uint256 payoutAmount);

  function isClaimable(uint256 tokenId) external view returns (bool);

  function getPayout(uint256 tokenId) external view returns (uint256);
}
