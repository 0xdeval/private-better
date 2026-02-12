import { NetworkName } from '@railgun-community/shared-models';

export const TEST_NETWORK = NetworkName.EthereumSepolia;

type RuntimeConfig = {
  RAILGUN_RPC?: string;
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

export const TEST_RPC_URL = env?.VITE_RAILGUN_RPC ?? runtimeConfig?.RAILGUN_RPC ?? '';

// Preferred var is VITE_USDC_ADDRESS; older chain-specific keys are fallback only.
export const TEST_USDC_ADDRESS =
  env?.VITE_USDC_ADDRESS ??
  env?.VITE_USDC_SEPOLIA ??
  env?.VITE_USDC_AMOY ??
  runtimeConfig?.USDC_ADDRESS ??
  runtimeConfig?.USDC_SEPOLIA ??
  runtimeConfig?.USDC_TESTNET ??
  runtimeConfig?.USDC_AMOY ??
  '0xYOUR_USDC_ADDRESS';
