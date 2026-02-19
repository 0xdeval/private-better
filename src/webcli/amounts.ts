import { BigNumber, ethers } from 'ethers';
import { SUPPLY_TOKEN_CONFIG } from './constants';

export const parseTokenAmount = (
  amountText: string,
  decimals: number = SUPPLY_TOKEN_CONFIG.decimals,
): bigint => BigInt(ethers.utils.parseUnits(amountText, decimals).toString());

export const formatTokenAmount = (
  amount: BigNumber | bigint,
  decimals: number = SUPPLY_TOKEN_CONFIG.decimals,
): string => ethers.utils.formatUnits(amount.toString(), decimals);
