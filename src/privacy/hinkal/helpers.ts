import { Wallet } from 'ethers';
import type { HinkalLike, HinkalSubAccount, HinkalToken } from './types';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value != null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

export const extractTxHash = (result: unknown): string | undefined => {
  if (typeof result === 'string' && result.length > 0) {
    return result;
  }

  const obj = asRecord(result);
  if (!obj) return undefined;

  const direct = obj.txHash ?? obj.hash ?? obj.transactionHash;
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const tx = asRecord(obj.transaction);
  if (!tx) return undefined;

  const nested = tx.hash ?? tx.transactionHash;
  if (typeof nested === 'string' && nested.length > 0) return nested;
  return undefined;
};

export const getSeedPhrases = (mnemonic: string): string[] => {
  const seedPhrases = mnemonic
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (seedPhrases.length === 0) {
    throw new Error('Mnemonic is empty.');
  }
  return seedPhrases;
};

export const createToken = (params: {
  chainId: number;
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
}): HinkalToken => ({
  chainId: params.chainId,
  erc20TokenAddress: params.tokenAddress,
  name: params.name,
  symbol: params.symbol,
  decimals: params.decimals,
});

export const createSubAccount = (
  signerAddress: string,
  hinkal?: HinkalLike,
): HinkalSubAccount => {
  let subAccountPrivateKey: string | undefined;
  let subAccountAddress = signerAddress;

  if (typeof hinkal?.userKeys?.getSignerPrivateKeyFromNonce === 'function') {
    subAccountPrivateKey = hinkal.userKeys.getSignerPrivateKeyFromNonce(0n);
    subAccountAddress = new Wallet(subAccountPrivateKey).address;
  }

  return {
    index: subAccountPrivateKey ? 0 : null,
    name: 'default',
    createdAt: '1970-01-01T00:00:00.000Z',
    isHidden: false,
    isFavorite: false,
    isImported: false,
    ethAddress: subAccountAddress,
    privateKey: subAccountPrivateKey,
  };
};

export const getPrivateRecipientInfo = (hinkal: HinkalLike): string => {
  const recipientInfo = hinkal.getRecipientInfo?.();
  if (!recipientInfo) {
    throw new Error('Hinkal recipient info is unavailable; cannot complete private withdraw.');
  }
  return recipientInfo;
};

export const assertRuntimeSignerAddress = async (
  hinkal: HinkalLike,
  chainId: number,
  expectedSignerAddress: string,
): Promise<void> => {
  const byChain =
    typeof hinkal.getEthereumAddressByChain === 'function'
      ? await hinkal.getEthereumAddressByChain(chainId)
      : undefined;
  const fallback =
    byChain ??
    (typeof hinkal.getEthereumAddress === 'function' ? await hinkal.getEthereumAddress() : undefined);
  if (!fallback) return;
  if (fallback.toLowerCase() !== expectedSignerAddress.toLowerCase()) {
    throw new Error(
      `Hinkal runtime signer mismatch. Expected ${expectedSignerAddress}, got ${fallback}. Reconnect wallet and re-run login.`,
    );
  }
};
