import { BigNumber, ethers } from 'ethers';
import { TOKEN_DECIMALS } from './constants';

export const parseTokenAmount = (amountText: string): bigint =>
  BigInt(ethers.utils.parseUnits(amountText, TOKEN_DECIMALS).toString());

export const formatTokenAmount = (amount: BigNumber | bigint): string =>
  ethers.utils.formatUnits(amount.toString(), TOKEN_DECIMALS);

