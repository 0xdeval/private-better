import { NetworkName } from '@railgun-community/shared-models';

export const TEST_NETWORK = NetworkName.PolygonAmoy;

type RuntimeConfig = {
  RAILGUN_RPC?: string;
  USDC_AMOY?: string;
};

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const runtimeConfig =
  typeof window !== 'undefined'
    ? (window as Window & { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__
    : undefined;

export const TEST_RPC_URL = env?.VITE_RAILGUN_RPC ?? runtimeConfig?.RAILGUN_RPC ?? '';

// Replace with official USDC token address deployed on Polygon Amoy.
export const USDC_AMOY =
  env?.VITE_USDC_AMOY ?? runtimeConfig?.USDC_AMOY ?? '0xYOUR_USDC_AMOY_ADDRESS';
