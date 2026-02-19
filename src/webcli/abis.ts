export const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
] as const;

export const ADAPTER_ABI = [
  'function nextPositionId() view returns (uint256)',
  'function privacyExecutor() view returns (address)',
  'function supplyToken() view returns (address)',
  'function isBorrowTokenAllowed(address token) view returns (bool)',
  'function positions(uint256) view returns (bytes32 zkOwnerHash, address vault, address token, uint256 amount, bytes32 withdrawAuthHash)',
  'function getPositionAccountData(uint256 positionId) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getOwnerPositionIds(bytes32 zkOwnerHash, uint256 offset, uint256 limit) view returns (uint256[] ids, uint256 total)',
] as const;
