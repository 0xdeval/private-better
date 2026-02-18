type NetworkConfig = {
  name: 'Arbitrum';
  chainId: number;
  chainIdHex: string;
  rpcFallback: string;
  explorer: string;
  nativeSymbol: string;
};

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const ARBITRUM_NETWORK: NetworkConfig = {
  name: 'Arbitrum',
  chainId: 42161,
  chainIdHex: '0xa4b1',
  rpcFallback: 'https://arb1.arbitrum.io/rpc',
  explorer: 'https://arbitrum.blockscout.com',
  nativeSymbol: 'ETH',
};


export const PRIVATE_NETWORK = env?.VITE_PRIVATE_NETWORK ?? '';
export const PRIVATE_CHAIN = ARBITRUM_NETWORK;

export const PRIVATE_RPC_URL = env?.VITE_PRIVATE_RPC ?? '';
export const PRIVATE_EMPORIUM_ADDRESS =
  env?.VITE_PRIVATE_EMPORIUM ?? "";
export const PRIVATE_SUPPLY_ADAPTER_ADDRESS =
  env?.VITE_PRIVATE_SUPPLY_ADAPTER ?? '';
export const SUPPLY_TOKEN_ADDRESS = env?.VITE_SUPPLY_TOKEN ?? '';

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
