export type HinkalToken = {
  chainId: number;
  erc20TokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type HinkalSubAccount = {
  index: number | null;
  name: string;
  createdAt: string;
  isHidden: boolean;
  isFavorite: boolean;
  isImported: boolean;
  ethAddress?: string;
  privateKey?: string;
};

export type HinkalContract = { address?: string };

export type HinkalLike = {
  initUserKeysWithPassword?: (password: string) => Promise<void>;
  initUserKeys?: (isPrivateTransfer?: boolean) => Promise<void>;
  resetMerkle: () => Promise<void>;
  checkAccessToken: () => Promise<boolean>;
  getRecipientInfo?: () => string;
  userKeys?: {
    getShieldedPrivateKey?: () => string;
    getShieldedPublicKey?: () => string;
    getSignerPrivateKeyFromNonce?: (nonce: bigint) => string;
  };
  getEthereumAddress?: () => Promise<string>;
  getEthereumAddressByChain?: (chainId: number) => Promise<string>;
  getContract: (contractType: number, contractAddress?: string, chainId?: number) => HinkalContract;
  getBalances?: (
    chainId: number,
    shieldedPrivateKey?: string,
    shieldedPublicKey?: string,
    ethAddress?: string,
    resetCacheBefore?: boolean,
    updatePrivateTokens?: boolean,
    useBlockedUtxos?: boolean,
  ) => Promise<Map<string, { balance: bigint }>>;
  deposit: (erc20Tokens: HinkalToken[], amountChanges: bigint[]) => Promise<unknown>;
  withdraw: (
    erc20Tokens: HinkalToken[],
    deltaAmounts: bigint[],
    recipientAddress: string,
    isRelayerOff: boolean,
  ) => Promise<unknown>;
  actionPrivateWallet: (
    erc20Addresses: string[],
    deltaAmounts: bigint[],
    onChainCreation: boolean[],
    ops: string[],
    emporiumTokenChanges: Array<{ token: HinkalToken; amount: bigint }>,
    subAccount: HinkalSubAccount,
    feeToken?: string,
    feeStructure?: unknown,
    relay?: string,
    isRelayerOff?: boolean,
    autoDepositBackGasLimit?: unknown,
    adminData?: unknown,
    recipientData?: {
      recipientInfo: string;
      amount: bigint;
      token: HinkalToken;
    },
    isSandbox?: boolean,
  ) => Promise<unknown>;
};
