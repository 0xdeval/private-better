import { Wallet, ethers, type Signer } from 'ethers';
import { prepareEthersHinkal } from '@hinkal/common/providers/prepareEthersHinkal';

import { HINKAL_CONTRACT_TYPE, PRIVATE_CHAIN_ID } from './hinkal/constants';
import {
  assertRuntimeSignerAddress,
  createSubAccount,
  createToken,
  extractTxHash,
  getSeedPhrases,
} from './hinkal/helpers';
import {
  buildPrivateBorrowOp,
  buildPrivateRepayOps,
  buildPrivateSupplyOps,
  buildPrivateWithdrawOp,
} from './hinkal/ops';
import type { HinkalLike } from './hinkal/types';

type ActionToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
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

  private getSessionKey(mnemonic: string, signerAddress: string): string {
    return `${this.getChainId()}:${signerAddress.toLowerCase()}:${mnemonic}`;
  }

  private toHinkalToken(token: ActionToken) {
    return createToken({
      chainId: this.getChainId(),
      tokenAddress: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
    });
  }

  private async getSessionHinkal(mnemonic: string, publicWallet: Signer): Promise<HinkalLike> {
    this.ensureInitialized();
    const signerAddress = (await publicWallet.getAddress()).toLowerCase();
    const sessionKey = this.getSessionKey(mnemonic, signerAddress);
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

      // Legacy compatibility: 0.2.21 initUserKeysFromSeedPhrases used keccak256(utf8(joined seed phrase)).
      if (typeof hinkal.initUserKeysWithPassword === 'function') {
        const normalizedMnemonic = getSeedPhrases(mnemonic).join(' ');
        const legacySeedHex = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(normalizedMnemonic));
        await hinkal.initUserKeysWithPassword(legacySeedHex);
      } else if (typeof hinkal.initUserKeys === 'function') {
        await hinkal.initUserKeys();
      }
      await hinkal.resetMerkle();
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
    const contract = hinkal.getContract(HINKAL_CONTRACT_TYPE, undefined, this.getChainId());
    const address = contract?.address;
    if (!address) {
      throw new Error('Could not resolve Hinkal shield contract address.');
    }
    return address;
  }

  async shieldToken(params: {
    mnemonic: string;
    token: ActionToken;
    amount: bigint;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), await params.publicWallet.getAddress());
    const token = this.toHinkalToken(params.token);
    const tx = await hinkal.deposit([token], [params.amount]);
    const txHash = this.txHashFromResult(tx, 'shield');
    this.sessions.clear();
    return txHash;
  }

  async unshieldToken(params: {
    mnemonic: string;
    token: ActionToken;
    amount: bigint;
    recipientAddress: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), await params.publicWallet.getAddress());
    const token = this.toHinkalToken(params.token);
    const tx = await hinkal.withdraw([token], [params.amount], params.recipientAddress, true);
    const txHash = this.txHashFromResult(tx, 'unshield');
    this.sessions.clear();
    return txHash;
  }

  async privateSupply(params: {
    mnemonic: string;
    adapterAddress: string;
    token: ActionToken;
    amount: bigint;
    zkOwnerHash: string;
    withdrawAuthHash: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const token = this.toHinkalToken(params.token);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);

    const ops = buildPrivateSupplyOps({
      adapterAddress: params.adapterAddress,
      tokenAddress: params.token.address,
      amount: params.amount,
      zkOwnerHash: params.zkOwnerHash,
      withdrawAuthHash: params.withdrawAuthHash,
    });

    const subAccount = createSubAccount(signerAddress, hinkal);
    if (!subAccount.privateKey) {
      throw new Error('Hinkal sub-account signing key is unavailable; cannot execute private supply safely.');
    }

    const result = await hinkal.actionPrivateWallet(
      [params.token.address],
      [-params.amount],
      [false],
      ops,
      [{ token, amount: -params.amount }],
      subAccount,
      params.token.address,
    );

    const txHash = this.txHashFromResult(result, 'private-supply');
    this.sessions.clear();
    return txHash;
  }

  async getPrivateSpendableBalance(params: {
    mnemonic: string;
    tokenAddress: string;
    publicWallet: Signer;
    forceRefresh?: boolean;
  }): Promise<bigint> {
    const signerAddress = await params.publicWallet.getAddress();
    const tokenAddress = params.tokenAddress.toLowerCase();
    if (params.forceRefresh) {
      this.sessions.delete(this.getSessionKey(params.mnemonic, signerAddress));
    }
    const readBalance = async (hinkal: HinkalLike): Promise<bigint> => {
      await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);
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
        Boolean(params.forceRefresh),
        true,
        false,
      );
      const balanceEntry = balances.get(tokenAddress);
      return balanceEntry?.balance ?? 0n;
    };

    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    try {
      return await readBalance(hinkal);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
      if (!message.includes('chain/address changed')) {
        throw error;
      }
      // SDK session can become stale after provider account/chain transitions; rebuild once.
      this.sessions.clear();
      const refreshed = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
      try {
        return await readBalance(refreshed);
      } catch (retryError) {
        const retryMessage = (retryError instanceof Error ? retryError.message : String(retryError)).toLowerCase();
        if (!retryMessage.includes('chain/address changed')) {
          throw retryError;
        }
        throw new Error(
          'Chain/address changed in Hinkal session. Re-run `login` and try `private-balance` again.',
        );
      }
    }
  }

  async getPrivateActionContext(params: {
    mnemonic: string;
    publicWallet: Signer;
  }): Promise<{ runtimeSigner: string | null; subAccountAddress: string; hasSubAccountKey: boolean }> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);

    const byChain =
      typeof hinkal.getEthereumAddressByChain === 'function'
        ? await hinkal.getEthereumAddressByChain(this.getChainId())
        : null;
    const runtimeSigner =
      byChain ??
      (typeof hinkal.getEthereumAddress === 'function' ? await hinkal.getEthereumAddress() : null);
    const subAccount = createSubAccount(signerAddress, hinkal);
    return {
      runtimeSigner,
      subAccountAddress: subAccount.ethAddress ?? signerAddress,
      hasSubAccountKey: Boolean(subAccount.privateKey),
    };
  }

  async privateWithdraw(params: {
    mnemonic: string;
    adapterAddress: string;
    emporiumAddress: string;
    token: ActionToken;
    positionId: bigint;
    amount: bigint;
    withdrawAuthSecret: string;
    nextWithdrawAuthHash: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);
    const token = this.toHinkalToken(params.token);

    const op = buildPrivateWithdrawOp({
      adapterAddress: params.adapterAddress,
      emporiumAddress: params.emporiumAddress,
      positionId: params.positionId,
      amount: params.amount,
      withdrawAuthSecret: params.withdrawAuthSecret,
      nextWithdrawAuthHash: params.nextWithdrawAuthHash,
    });

    const subAccount = createSubAccount(signerAddress, hinkal);
    if (!subAccount.privateKey) {
      throw new Error('Hinkal sub-account signing key is unavailable; cannot execute private withdraw safely.');
    }

    const result = await hinkal.actionPrivateWallet(
      [params.token.address],
      [params.amount],
      [true],
      [op],
      [{ token, amount: params.amount }],
      subAccount,
      params.token.address,
    );

    const txHash = this.txHashFromResult(result, 'private-withdraw');
    this.sessions.clear();
    return txHash;
  }

  async privateBorrow(params: {
    mnemonic: string;
    adapterAddress: string;
    emporiumAddress: string;
    borrowToken: ActionToken;
    feeToken: ActionToken;
    positionId: bigint;
    amount: bigint;
    authSecret: string;
    nextAuthHash: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);
    const borrowToken = this.toHinkalToken(params.borrowToken);

    const op = buildPrivateBorrowOp({
      adapterAddress: params.adapterAddress,
      emporiumAddress: params.emporiumAddress,
      positionId: params.positionId,
      debtToken: params.borrowToken.address,
      amount: params.amount,
      authSecret: params.authSecret,
      nextAuthHash: params.nextAuthHash,
    });

    const subAccount = createSubAccount(signerAddress, hinkal);
    if (!subAccount.privateKey) {
      throw new Error('Hinkal sub-account signing key is unavailable; cannot execute private borrow safely.');
    }

    const result = await hinkal.actionPrivateWallet(
      [params.borrowToken.address],
      [params.amount],
      [true],
      [op],
      [{ token: borrowToken, amount: params.amount }],
      subAccount,
      params.feeToken.address,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const txHash = this.txHashFromResult(result, 'private-borrow');
    this.sessions.clear();
    return txHash;
  }

  async privateRepay(params: {
    mnemonic: string;
    adapterAddress: string;
    debtToken: ActionToken;
    feeToken: ActionToken;
    positionId: bigint;
    amount: bigint;
    authSecret: string;
    nextAuthHash: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);
    const debtToken = this.toHinkalToken(params.debtToken);

    const ops = buildPrivateRepayOps({
      adapterAddress: params.adapterAddress,
      debtToken: params.debtToken.address,
      positionId: params.positionId,
      amount: params.amount,
      authSecret: params.authSecret,
      nextAuthHash: params.nextAuthHash,
    });

    const subAccount = createSubAccount(signerAddress, hinkal);
    if (!subAccount.privateKey) {
      throw new Error('Hinkal sub-account signing key is unavailable; cannot execute private repay safely.');
    }

    const result = await hinkal.actionPrivateWallet(
      [params.debtToken.address],
      [-params.amount],
      [false],
      ops,
      [{ token: debtToken, amount: params.amount }],
      subAccount,
      params.feeToken.address,
    );

    const txHash = this.txHashFromResult(result, 'private-repay');
    this.sessions.clear();
    return txHash;
  }
}
