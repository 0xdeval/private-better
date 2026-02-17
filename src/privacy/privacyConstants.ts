export type RuntimeConfig = {
  PRIVATE_NETWORK?: string;
  PRIVATE_RPC?: string;
  PRIVATE_EMPORIUM?: string;
  PRIVATE_SUPPLY_ADAPTER?: string;
  SUPPLY_TOKEN?: string;
};

type NetworkConfig = {
  name: 'Arbitrum';
  chainId: number;
  chainIdHex: string;
  rpcFallback: string;
  explorer: string;
  nativeSymbol: string;
};

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const runtimeConfig =
  typeof window !== 'undefined'
    ? (window as Window & { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__
    : undefined;

export const ARBITRUM_NETWORK: NetworkConfig = {
  name: 'Arbitrum',
  chainId: 42161,
  chainIdHex: '0xa4b1',
  rpcFallback: 'https://arb1.arbitrum.io/rpc',
  explorer: 'https://arbiscan.io',
  nativeSymbol: 'ETH',
};

export const ARBITRUM_EMPORIUM_ADDRESS = '0xcA64D9B41710Bd6e1818D3F0bED939F8e7c5a490';

const rawNetwork = env?.VITE_PRIVATE_NETWORK ?? runtimeConfig?.PRIVATE_NETWORK;

export const PRIVATE_NETWORK = rawNetwork === 'Arbitrum' || rawNetwork == null ? 'Arbitrum' : 'Arbitrum';
export const PRIVATE_CHAIN = ARBITRUM_NETWORK;

export const PRIVATE_RPC_URL = env?.VITE_PRIVATE_RPC ?? runtimeConfig?.PRIVATE_RPC ?? '';
export const PRIVATE_EMPORIUM_ADDRESS =
  env?.VITE_PRIVATE_EMPORIUM ?? runtimeConfig?.PRIVATE_EMPORIUM ?? ARBITRUM_EMPORIUM_ADDRESS;
export const PRIVATE_SUPPLY_ADAPTER_ADDRESS =
  env?.VITE_PRIVATE_SUPPLY_ADAPTER ?? runtimeConfig?.PRIVATE_SUPPLY_ADAPTER ?? '';
export const SUPPLY_TOKEN_ADDRESS = env?.VITE_SUPPLY_TOKEN ?? runtimeConfig?.SUPPLY_TOKEN ?? '';

export const PRIVATE_CHAIN_PARAMS = {
  chainId: PRIVATE_CHAIN.chainIdHex,
  chainName: PRIVATE_CHAIN.name,
  nativeCurrency: {
    name: PRIVATE_CHAIN.nativeSymbol,
    symbol: PRIVATE_CHAIN.nativeSymbol,
    decimals: 18,
  },
  rpcUrls: [PRIVATE_RPC_URL || PRIVATE_CHAIN.rpcFallback],
  blockExplorerUrls: [PRIVATE_CHAIN.explorer],
};
