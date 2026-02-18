import { Wallet, type Signer } from 'ethers';
import { prepareEthersHinkal } from '@hinkal/common/providers/prepareEthersHinkal';

import { HINKAL_CONTRACT_TYPE, PRIVATE_CHAIN_ID } from './hinkal/constants';
import {
  assertRuntimeSignerAddress,
  createSubAccount,
  createToken,
  extractTxHash,
  getPrivateRecipientInfo,
  getSeedPhrases,
} from './hinkal/helpers';
import { buildPrivateSupplyOps, buildPrivateWithdrawOp } from './hinkal/ops';
import type { HinkalLike } from './hinkal/types';

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

      await hinkal.initUserKeysFromSeedPhrases(getSeedPhrases(mnemonic));
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
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), await params.publicWallet.getAddress());
    const token = createToken(this.getChainId(), params.tokenAddress);
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
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), await params.publicWallet.getAddress());
    const token = createToken(this.getChainId(), params.tokenAddress);
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
    const token = createToken(this.getChainId(), params.tokenAddress);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);

    const ops = buildPrivateSupplyOps({
      adapterAddress: params.adapterAddress,
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      zkOwnerHash: params.zkOwnerHash,
      withdrawAuthHash: params.withdrawAuthHash,
    });

    const subAccount = createSubAccount(signerAddress, hinkal);
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
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);
    const subAccount = createSubAccount(signerAddress, hinkal);
    const activeBalanceAddress = subAccount.ethAddress ?? signerAddress;

    const privateKey = hinkal.userKeys?.getShieldedPrivateKey?.();
    const publicKey = hinkal.userKeys?.getShieldedPublicKey?.();
    if (!privateKey || !publicKey || typeof hinkal.getBalances !== 'function') {
      throw new Error('Hinkal SDK balance API is unavailable in this runtime.');
    }

    // Force merkle + balance cache refresh so private-balance reflects recent private actions.
    await hinkal.resetMerkle([this.getChainId()]);
    const balances = await hinkal.getBalances(
      this.getChainId(),
      privateKey,
      publicKey,
      activeBalanceAddress,
      true,
      true,
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
    tokenAddress: string;
    positionId: bigint;
    amount: bigint;
    withdrawAuthSecret: string;
    nextWithdrawAuthHash: string;
    publicWallet: Signer;
  }): Promise<string> {
    const hinkal = await this.getSessionHinkal(params.mnemonic, params.publicWallet);
    const signerAddress = await params.publicWallet.getAddress();
    await assertRuntimeSignerAddress(hinkal, this.getChainId(), signerAddress);
    const token = createToken(this.getChainId(), params.tokenAddress);
    const recipientInfo = getPrivateRecipientInfo(hinkal);

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
      this.getChainId(),
      [token],
      [0n],
      [false],
      [op],
      [{ token, amount: params.amount }],
      subAccount,
      params.tokenAddress,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recipientInfo,
        amount: params.amount,
        token,
      },
    );

    return this.txHashFromResult(result, 'private-withdraw');
  }
}
