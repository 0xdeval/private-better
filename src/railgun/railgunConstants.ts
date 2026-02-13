import { NetworkName } from '@railgun-community/shared-models';

type RuntimeConfig = {
  RAILGUN_NETWORK?: string;
  RAILGUN_RPC?: string;
  SUPPLY_TOKEN?: string;
  PRIVATE_SUPPLY_ADAPTER?: string;
  USDC_ADDRESS?: string;
  USDC_SEPOLIA?: string;
  USDC_TESTNET?: string;
  USDC_AMOY?: string;
};

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const runtimeConfig =
  typeof window !== 'undefined'
    ? (window as Window & { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__
    : undefined;

const resolveNetworkName = (raw: string | undefined): NetworkName => {
  switch (raw) {
    case NetworkName.Ethereum:
      return NetworkName.Ethereum;
    case NetworkName.BNBChain:
      return NetworkName.BNBChain;
    case NetworkName.Polygon:
      return NetworkName.Polygon;
    case NetworkName.Arbitrum:
      return NetworkName.Arbitrum;
    case NetworkName.EthereumSepolia:
      return NetworkName.EthereumSepolia;
    case NetworkName.PolygonAmoy:
      return NetworkName.PolygonAmoy;
    case NetworkName.Hardhat:
      return NetworkName.Hardhat;
    default:
      return NetworkName.Arbitrum;
  }
};

export const TEST_NETWORK = resolveNetworkName(
  env?.VITE_RAILGUN_NETWORK ?? runtimeConfig?.RAILGUN_NETWORK,
);

export const TEST_RPC_URL = env?.VITE_RAILGUN_RPC ?? runtimeConfig?.RAILGUN_RPC ?? '';

// Preferred var is VITE_USDC_ADDRESS; older chain-specific keys are fallback only.
export const TEST_USDC_ADDRESS =
  env?.VITE_SUPPLY_TOKEN ??
  env?.VITE_USDC_ADDRESS ??
  runtimeConfig?.SUPPLY_TOKEN ??
  env?.VITE_USDC_SEPOLIA ??
  env?.VITE_USDC_AMOY ??
  runtimeConfig?.USDC_ADDRESS ??
  runtimeConfig?.USDC_SEPOLIA ??
  runtimeConfig?.USDC_TESTNET ??
  runtimeConfig?.USDC_AMOY ??
  '0xYOUR_USDC_ADDRESS';

export const PRIVATE_SUPPLY_ADAPTER_ADDRESS =
  env?.VITE_PRIVATE_SUPPLY_ADAPTER ??
  runtimeConfig?.PRIVATE_SUPPLY_ADAPTER ??
  '0xYOUR_PRIVATE_SUPPLY_ADAPTER';
