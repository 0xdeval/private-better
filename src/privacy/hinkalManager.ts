import { Wallet, ethers, type Signer } from 'ethers';
import { emporiumOp } from '@hinkal/common';
import { prepareEthersHinkal } from '@hinkal/common/providers/prepareEthersHinkal';

type HinkalToken = {
  chainId: number;
  erc20TokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
};

type HinkalSubAccount = {
  index: number | null;
  name: string;
  createdAt: string;
  isHidden: boolean;
  isFavorite: boolean;
  isImported: boolean;
  ethAddress?: string;
  privateKey?: string;
};

type HinkalContract = { address?: string };

type HinkalLike = {
  initUserKeysFromSeedPhrases: (seedPhrases: string[]) => Promise<void>;
  resetMerkle: (chains?: number[]) => Promise<void>;
  checkAccessToken: (chainId: number) => Promise<boolean>;
  userKeys?: {
    getShieldedPrivateKey?: () => string;
    getShieldedPublicKey?: () => string;
    getSignerPrivateKeyFromNonce?: (nonce: bigint) => string;
  };
  getEthereumAddress?: () => Promise<string>;
  getEthereumAddressByChain?: (chainId: number) => Promise<string>;
  getContract: (chainId: number, contractType: number, contractAddress?: string) => HinkalContract;
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
    chainId: number,
    erc20Tokens: HinkalToken[],
    deltaAmounts: bigint[],
    onChainCreation: boolean[],
    ops: string[],
    emporiumTokenChanges: Array<{ token: HinkalToken; amount: bigint }>,
    subAccount: HinkalSubAccount,
    feeToken?: string,
  ) => Promise<unknown>;
};

const PRIVATE_CHAIN_ID = 42161;
const HINKAL_CONTRACT_TYPE = 0; // ContractType.HinkalContract

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value != null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const extractTxHash = (result: unknown): string | undefined => {
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

export class HinkalManager {
  private initialized = false;
  private rpcUrl = '';
  private network = 'Arbitrum';
  private sessions = new Map<string, Promise<HinkalLike>>();

  async initEngine(rpcUrl: string, networkName = 'Arbitrum'): Promise<void> {
    if (!rpcUrl) {
      throw new Error('Missing VITE_PRIVATE_RPC.');
    }

    if (this.rpcUrl !== rpcUrl || this.network !== networkName) {
      this.sessions.clear();
    }

    this.rpcUrl = rpcUrl;
    this.network = networkName;
    this.initialized = true;
  }

  derivePrivateAddress(mnemonic: string): string {
    return Wallet.fromMnemonic(mnemonic).address;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Privacy manager is not initialized. Call initEngine first.');
    }
  }

  private getChainId(): number {
    return PRIVATE_CHAIN_ID;
  }

  private getSeedPhrases(mnemonic: string): string[] {
    const seedPhrases = mnemonic
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    if (seedPhrases.length === 0) {
      throw new Error('Mnemonic is empty.');
    }
    return seedPhrases;
  }

  private createToken(tokenAddress: string): HinkalToken {
    return {
      chainId: this.getChainId(),
      erc20TokenAddress: tokenAddress,
      name: 'USDC',
      symbol: 'USDC',
      decimals: 6,
    };
  }

  private createSubAccount(signerAddress: string, hinkal?: HinkalLike): HinkalSubAccount {
    let subAccountPrivateKey: string | undefined;
    let subAccountAddress = signerAddress;

    if (typeof hinkal?.userKeys?.getSignerPrivateKeyFromNonce === 'function') {
      // Keep the sub-account deterministic so Hinkal signs Emporium metadata with a stable key.
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
  }

  private async assertRuntimeSignerAddress(
    hinkal: HinkalLike,
    expectedSignerAddress: string,
  ): Promise<void> {
    const byChain =
      typeof hinkal.getEthereumAddressByChain === 'function'
        ? await hinkal.getEthereumAddressByChain(this.getChainId())
        : undefined;
    const fallback =
      byChain ??
      (typeof hinkal.getEthereumAddress === 'function' ? await hinkal.getEthereumAddress() : undefined);
    if (!fallback) return;
    if (fallback.toLowerCase() !== expectedSignerAddress.toLowerCase()) {
      throw new Error(
        `Hinkal runtime signer mismatch. Expected ${expectedSignerAddress}, got ${fallback}. Reconnect wallet and re-run privacy-login.`,
      );
    }
  }

  private async getSessionHinkal(mnemonic: string, publicWallet: Signer): Promise<HinkalLike> {
    this.ensureInitialized();
    const signerAddress = (await publicWallet.getAddress()).toLowerCase();
    const sessionKey = `${this.getChainId()}:${signerAddress}:${mnemonic}`;
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const sessionPromise = (async () => {
      let hinkal: HinkalLike;
      try {
        hinkal = (await prepareEthersHinkal(publicWallet as unknown as any, {
          disableCaching: true,
          generateProofRemotely: true,
        })) as unknown as HinkalLike;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Hinkal SDK is unavailable at runtime. ${message}`);
      }

      await hinkal.initUserKeysFromSeedPhrases(this.getSeedPhrases(mnemonic));
      await hinkal.resetMerkle([this.getChainId()]);
      return hinkal;
    })();

    this.sessions.set(sessionKey, sessionPromise);
    try {
      return await sessionPromise;
    } catch (error) {
      this.sessions.delete(sessionKey);
      throw error;
    }
  }

  private txHashFromResult(result: unknown, actionLabel: string): string {
    const txHash = extractTxHash(result);
    if (!txHash) {
      throw new Error(`Hinkal ${actionLabel} action did not return a transaction hash.`);
    }
    return txHash;
  }

  async getShieldSpender(params: { mnemonic: string; publicWallet: Signer }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const contract = hinkal.getContract(this.getChainId(), HINKAL_CONTRACT_TYPE);
    const address = contract?.address;
    if (!address) {
      throw new Error('Could not resolve Hinkal shield contract address.');
    }
    return address;
  }

  async shieldToken(params: {
    mnemonic: string;
    tokenAddress: string;
    amount: bigint;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    await this.assertRuntimeSignerAddress(hinkal, await params.publicWallet.getAddress());
    const token = this.createToken(params.tokenAddress);
    const tx = await hinkal.deposit([token], [params.amount]);
    return this.txHashFromResult(tx, 'shield');
  }

  async unshieldToken(params: {
    mnemonic: string;
    tokenAddress: string;
    amount: bigint;
    recipientAddress: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    await this.assertRuntimeSignerAddress(hinkal, await params.publicWallet.getAddress());
    const token = this.createToken(params.tokenAddress);
    const tx = await hinkal.withdraw([token], [params.amount], params.recipientAddress, true);
    return this.txHashFromResult(tx, 'unshield');
  }

  async privateSupply(params: {
    mnemonic: string;
    adapterAddress: string;
    tokenAddress: string;
    amount: bigint;
    zkOwnerHash: string;
    withdrawAuthHash: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const token = this.createToken(params.tokenAddress);
    const signerAddress = await params.publicWallet.getAddress();
    await this.assertRuntimeSignerAddress(hinkal, signerAddress);

    const erc20Interface = new ethers.utils.Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ]);
    const adapterInterface = new ethers.utils.Interface([
      'function onPrivateDeposit(address token, uint256 amount, bytes data) returns (uint256)',
    ]);
    const requestData = ethers.utils.defaultAbiCoder.encode(
      ['tuple(bytes32 zkOwnerHash, bytes32 withdrawAuthHash)'],
      [{ zkOwnerHash: params.zkOwnerHash, withdrawAuthHash: params.withdrawAuthHash }],
    );

    const ops = [
      emporiumOp({
        contract: params.tokenAddress,
        callDataString: erc20Interface.encodeFunctionData('transfer', [
          params.adapterAddress,
          params.amount,
        ]),
        // Funds are unshielded into Emporium for this action; transfer from Emporium, not the stateful wallet.
        invokeWallet: false,
      }),
      emporiumOp({
        contract: params.adapterAddress,
        callDataString: adapterInterface.encodeFunctionData('onPrivateDeposit', [
          params.tokenAddress,
          params.amount,
          requestData,
        ]),
        invokeWallet: false,
      }),
    ];

    const subAccount = this.createSubAccount(signerAddress, hinkal);
    if (!subAccount.privateKey) {
      throw new Error('Hinkal sub-account signing key is unavailable; cannot execute private supply safely.');
    }

    const result = await hinkal.actionPrivateWallet(
      this.getChainId(),
      [token],
      [-params.amount],
      [false],
      ops,
      [{ token, amount: -params.amount }],
      subAccount,
      params.tokenAddress,
    );

    return this.txHashFromResult(result, 'private-supply');
  }

  async getPrivateSpendableBalance(params: {
    mnemonic: string;
    tokenAddress: string;
    publicWallet: Signer;
  }): Promise<bigint> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await this.assertRuntimeSignerAddress(hinkal, signerAddress);

    const privateKey = hinkal.userKeys?.getShieldedPrivateKey?.();
    const publicKey = hinkal.userKeys?.getShieldedPublicKey?.();
    if (!privateKey || !publicKey || typeof hinkal.getBalances !== 'function') {
      throw new Error('Hinkal SDK balance API is unavailable in this runtime.');
    }

    const balances = await hinkal.getBalances(
      this.getChainId(),
      privateKey,
      publicKey,
      signerAddress,
      false,
      false,
      false,
    );
    const balanceEntry = balances.get(params.tokenAddress.toLowerCase());
    return balanceEntry?.balance ?? 0n;
  }

  async getPrivateActionContext(params: {
    mnemonic: string;
    publicWallet: Signer;
  }): Promise<{ runtimeSigner: string | null; subAccountAddress: string; hasSubAccountKey: boolean }> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await this.assertRuntimeSignerAddress(hinkal, signerAddress);

    const byChain =
      typeof hinkal.getEthereumAddressByChain === 'function'
        ? await hinkal.getEthereumAddressByChain(this.getChainId())
        : null;
    const runtimeSigner =
      byChain ??
      (typeof hinkal.getEthereumAddress === 'function' ? await hinkal.getEthereumAddress() : null);
    const subAccount = this.createSubAccount(signerAddress, hinkal);
    return {
      runtimeSigner,
      subAccountAddress: subAccount.ethAddress ?? signerAddress,
      hasSubAccountKey: Boolean(subAccount.privateKey),
    };
  }

  async privateWithdraw(params: {
    mnemonic: string;
    adapterAddress: string;
    tokenAddress: string;
    positionId: bigint;
    amount: bigint;
    withdrawAuthSecret: string;
    nextWithdrawAuthHash: string;
    recipientAddress: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await this.assertRuntimeSignerAddress(hinkal, signerAddress);
    const adapterInterface = new ethers.utils.Interface([
      'function withdrawToRecipient(uint256 positionId, uint256 amount, bytes32 withdrawAuthSecret, bytes32 nextWithdrawAuthHash, address recipient) returns (uint256)',
    ]);

    const op = emporiumOp({
      contract: params.adapterAddress,
      callDataString: adapterInterface.encodeFunctionData('withdrawToRecipient', [
        params.positionId,
        params.amount,
        params.withdrawAuthSecret,
        params.nextWithdrawAuthHash,
        params.recipientAddress,
      ]),
    });

    const subAccount = this.createSubAccount(signerAddress, hinkal);
    if (!subAccount.privateKey) {
      throw new Error('Hinkal sub-account signing key is unavailable; cannot execute private withdraw safely.');
    }

    const result = await hinkal.actionPrivateWallet(
      this.getChainId(),
      [],
      [],
      [],
      [op],
      [],
      subAccount,
      params.tokenAddress,
    );

    return this.txHashFromResult(result, 'private-withdraw');
  }
}
