import { ethers } from "ethers";

export const TOKEN_DECIMALS = 6;

export const DEFAULT_PRIVATE_FEE_BUFFER_BPS = 2_000n;
export const FEE_BPS_DENOMINATOR = 10_000n;
export const DEFAULT_PRIVATE_FEE_BUFFER_MIN = BigInt(
    ethers.utils.parseUnits('0.002', TOKEN_DECIMALS).toString(),
);
