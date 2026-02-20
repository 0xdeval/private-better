import { ethers } from "ethers";

export type CliTokenConfig = {
    name: string;
    symbol: string;
    decimals: number;
};

export const SUPPLY_TOKEN_CONFIG: CliTokenConfig = {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
};

export const BORROW_WETH_TOKEN_CONFIG: CliTokenConfig = {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
};

export const DEFAULT_PRIVATE_FEE_BUFFER_BPS = 2_000n;
export const FEE_BPS_DENOMINATOR = 10_000n;
export const DEFAULT_PRIVATE_FEE_BUFFER_MIN = BigInt(
    ethers.utils.parseUnits('0.002', SUPPLY_TOKEN_CONFIG.decimals).toString(),
);
