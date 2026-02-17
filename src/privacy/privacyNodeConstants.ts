type NetworkConfig = {
  name: 'Arbitrum';
  chainId: number;
  chainIdHex: string;
  rpcFallback: string;
  explorer: string;
  nativeSymbol: string;
};

const env = process.env;

export const ARBITRUM_NETWORK: NetworkConfig = {
  name: 'Arbitrum',
  chainId: 42161,
  chainIdHex: '0xa4b1',
  rpcFallback: 'https://arb1.arbitrum.io/rpc',
  explorer: 'https://arbiscan.io',
  nativeSymbol: 'ETH',
};

export const ARBITRUM_EMPORIUM_ADDRESS = '0xcA64D9B41710Bd6e1818D3F0bED939F8e7c5a490';

const rawNetwork = env.VITE_PRIVATE_NETWORK;
export const PRIVATE_NETWORK = rawNetwork === 'Arbitrum' || rawNetwork == null ? 'Arbitrum' : 'Arbitrum';
export const PRIVATE_CHAIN = ARBITRUM_NETWORK;

export const PRIVATE_RPC_URL = env.VITE_PRIVATE_RPC ?? env.RPC_URL ?? '';
export const PRIVATE_EMPORIUM_ADDRESS =
  env.VITE_PRIVATE_EMPORIUM ?? env.PRIVATE_EMPORIUM ?? ARBITRUM_EMPORIUM_ADDRESS;
export const PRIVATE_SUPPLY_ADAPTER_ADDRESS =
  env.VITE_PRIVATE_SUPPLY_ADAPTER ?? env.PRIVATE_SUPPLY_ADAPTER ?? '';
export const SUPPLY_TOKEN_ADDRESS = env.VITE_SUPPLY_TOKEN ?? env.SUPPLY_TOKEN ?? '';
export const PRIVATE_WALLET_PRIVATE_KEY =
  env.PRIVATE_WALLET_PRIVATE_KEY ?? env.DEPLOYER_PRIVATE_KEY ?? '';
export const DEFAULT_TEST_MNEMONIC = env.VITE_PRIVATE_TEST_MNEMONIC;
