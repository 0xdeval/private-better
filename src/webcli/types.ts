import type { ethers } from 'ethers';

export type LineType = 'normal' | 'ok' | 'err' | 'muted';

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  isRabby?: boolean;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: EthereumProvider[];
};

export type EthereumRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

export type SignerContext = {
  provider: ethers.providers.Web3Provider;
  signerAddress: string;
  providerLabel: string;
};

export type ActivePrivacySession = {
  privateAddress: string;
  mnemonic: string;
  positionSecrets: Record<string, string>;
  sessionKeyHex: string;
  eoaAddress: string;
  chainId: bigint;
};

export type FeeReserve = {
  reserve: bigint;
  bpsBuffer: bigint;
  minBuffer: bigint;
  usedBuffer: bigint;
};
