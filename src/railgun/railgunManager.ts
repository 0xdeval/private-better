import * as WalletSDK from '@railgun-community/wallet';
import { WalletBalanceBucket } from '@railgun-community/engine';
import {
  EVMGasType,
  NetworkName,
  NETWORK_CONFIG,
  TXIDVersion,
  getEVMGasTypeForTransaction,
  type FallbackProviderJsonConfig,
  type RailgunERC20Amount,
  type RailgunERC20AmountRecipient,
  type RailgunERC20Recipient,
  type RailgunNFTAmount,
  type RailgunNFTAmountRecipient,
  type RailgunWalletInfo,
  type TransactionGasDetails,
} from '@railgun-community/shared-models';
import { AbiCoder, Interface, keccak256 } from 'ethers';
import type { Signer } from 'ethers';

import { TEST_NETWORK, TEST_RPC_URL, TEST_USDC_ADDRESS } from './railgunConstants';
import { createBrowserArtifactStore, createWebDatabase } from './railgunStorage';

type CrossContractCall = {
  to: string;
  data: string;
  value?: bigint;
};

const ERC20_INTERFACE = new Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
]);

const ADAPTER_INTERFACE = new Interface([
  'function onRailgunUnshield(address token, uint256 amount, bytes data) returns (uint256 positionId)',
  'function withdrawAndShield(uint256 positionId, uint256 amount, bytes32 withdrawAuthSecret, bytes32 nextWithdrawAuthHash) returns (uint256 withdrawnAmount)',
]);

export class RailgunManager {
  private initialized = false;
  private proverEnabled = false;

  private normalizeEncryptionKey(encryptionKey: string): string {
    const clean = encryptionKey.startsWith('0x') ? encryptionKey.slice(2) : encryptionKey;
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
      throw new Error('Invalid Railgun encryption key format. Expected 32-byte hex value.');
    }
    return clean;
  }

  private normalizeNetworkConfigForInit(networkName: NetworkName): void {
    const config = NETWORK_CONFIG[networkName] as any;
    if (!config) return;

    if (
      config.supportsV3 &&
      (!config.poseidonMerkleAccumulatorV3Contract ||
        !config.poseidonMerkleVerifierV3Contract ||
        !config.tokenVaultV3Contract)
    ) {
      config.supportsV3 = false;
    }
  }

  private mapInitError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('UNCONFIGURED_NAME') || error.message.includes('value=""')) {
        return new Error(
          `Railgun init failed due to empty contract addresses for ${TEST_NETWORK} in shared-models. Retry \`init-railgun\` with a valid RPC.`,
        );
      }

      if (
        error.message.includes('Batch of more than 3 requests are not allowed on free tier') ||
        error.message.includes('code=SERVER_ERROR')
      ) {
        return new Error(
          `RPC rejected batched JSON-RPC requests for ${TEST_NETWORK}. Update VITE_RAILGUN_RPC to an endpoint that supports batching.`,
        );
      }

      return error;
    }

    return new Error('Unknown Railgun init error.');
  }

  async initEngine(rpcUrl = TEST_RPC_URL): Promise<void> {
    if (this.initialized) return;
    if (!rpcUrl) {
      throw new Error('Missing Railgun RPC URL. Set VITE_RAILGUN_RPC.');
    }

    this.normalizeNetworkConfigForInit(TEST_NETWORK);

    const db = createWebDatabase('railgun_engine_db');
    const artifactStore = createBrowserArtifactStore();

    await WalletSDK.startRailgunEngine(
      'privbet',
      db,
      true,
      artifactStore,
      false,
      false,
      ['https://ppoi-agg.horsewithsixlegs.xyz'],
      [],
      true,
    );

    try {
      await this.loadEngineProvider(TEST_NETWORK, rpcUrl);
    } catch (error) {
      throw this.mapInitError(error);
    }

    this.initialized = true;
  }

  async createWallet(mnemonic: string, encryptionKey: string): Promise<RailgunWalletInfo> {
    return WalletSDK.createRailgunWallet(this.normalizeEncryptionKey(encryptionKey), mnemonic, {});
  }

  async loadWallet(walletID: string, encryptionKey: string): Promise<RailgunWalletInfo> {
    return WalletSDK.loadWalletByID(this.normalizeEncryptionKey(encryptionKey), walletID, false);
  }

  async deleteWallet(walletID: string): Promise<void> {
    await WalletSDK.deleteWalletByID(walletID);
  }

  async enableSnarkJSProver(): Promise<void> {
    if (this.proverEnabled) return;
    const snarkjs = await import('snarkjs');
    WalletSDK.getProver().setSnarkJSGroth16(snarkjs.groth16 as any);
    this.proverEnabled = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await WalletSDK.stopRailgunEngine();
    this.initialized = false;
    this.proverEnabled = false;
  }

  async loadEngineProvider(networkName: NetworkName, rpcUrl: string): Promise<void> {
    const config: FallbackProviderJsonConfig = {
      chainId: NETWORK_CONFIG[networkName].chain.id,
      providers: [{ provider: rpcUrl, priority: 1, weight: 2, stallTimeout: 2000 }],
    };

    await WalletSDK.loadProvider(config, networkName, 10_000);
  }

  private getConnectedProvider(wallet: Signer) {
    const provider = wallet.provider;
    if (!provider) {
      throw new Error('Public wallet must be connected to an RPC provider.');
    }
    return provider;
  }

  private async getShieldSignature(wallet: Signer): Promise<string> {
    const message = WalletSDK.getShieldPrivateKeySignatureMessage();
    const signature = await wallet.signMessage(message);
    return keccak256(signature);
  }

  private async getGasDetailsForTransaction(
    networkName: NetworkName,
    gasEstimate: bigint,
    sendWithPublicWallet: boolean,
    wallet: Signer,
  ): Promise<TransactionGasDetails> {
    const provider = this.getConnectedProvider(wallet);
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    const feeData = await provider.getFeeData();

    if (evmGasType === EVMGasType.Type0 || evmGasType === EVMGasType.Type1) {
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
      if (gasPrice == null) {
        throw new Error('Could not resolve gasPrice from provider fee data.');
      }

      return {
        evmGasType,
        gasEstimate,
        gasPrice,
      };
    }

    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (maxFeePerGas == null) {
      throw new Error('Could not resolve maxFeePerGas from provider fee data.');
    }

    return {
      evmGasType,
      gasEstimate,
      maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
    };
  }

  private serializeERC20Transfer(
    tokenAddress: string,
    amount: bigint,
    recipientAddress: string,
  ): RailgunERC20AmountRecipient {
    return {
      tokenAddress,
      amount,
      recipientAddress,
    };
  }

  async shieldUSDC(
    railgunWalletAddress: string,
    publicWallet: Signer,
    amount: bigint,
    tokenAddressOverride?: string,
  ): Promise<string> {
    this.getConnectedProvider(publicWallet);
    const tokenAddress = tokenAddressOverride ?? TEST_USDC_ADDRESS;
    if (tokenAddress === '0xYOUR_USDC_ADDRESS') {
      throw new Error(
        'USDC token is not configured. Set VITE_USDC_ADDRESS (or legacy fallback keys).',
      );
    }

    const erc20AmountRecipients = [
      this.serializeERC20Transfer(tokenAddress, amount, railgunWalletAddress),
    ];

    const shieldPrivateKey = await this.getShieldSignature(publicWallet);
    const signerAddress = await publicWallet.getAddress();

    const { gasEstimate } = await WalletSDK.gasEstimateForShield(
      TXIDVersion.V2_PoseidonMerkle,
      TEST_NETWORK,
      shieldPrivateKey,
      erc20AmountRecipients,
      [],
      signerAddress,
    );

    const gasDetails = await this.getGasDetailsForTransaction(
      TEST_NETWORK,
      gasEstimate,
      true,
      publicWallet,
    );

    const { transaction } = await WalletSDK.populateShield(
      TXIDVersion.V2_PoseidonMerkle,
      TEST_NETWORK,
      shieldPrivateKey,
      erc20AmountRecipients,
      [],
      gasDetails,
    );

    const txResponse = await publicWallet.sendTransaction(transaction as any);
    await txResponse.wait();
    return txResponse.hash;
  }

  // TODO: Fix the RPC limits issue
  // Currently impossible to fetch live balance due to RPC limits. Need to get paid one? 
  async getShieldedTokenBalance(walletID: string, tokenAddress: string): Promise<bigint> {
    const chain = NETWORK_CONFIG[TEST_NETWORK].chain;
    await WalletSDK.refreshBalances(chain, [walletID]);
    const wallet = WalletSDK.fullWalletForID(walletID);
    const amount = await wallet.getBalanceERC20(TXIDVersion.V2_PoseidonMerkle, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
      WalletBalanceBucket.ShieldPending,
      WalletBalanceBucket.ProofSubmitted,
    ]);
    return amount ?? 0n;
  }

  private async sendCrossContractRailgunTx(
    walletID: string,
    encryptionKey: string,
    publicWallet: Signer,
    relayAdaptUnshieldERC20Amounts: RailgunERC20Amount[],
    crossContractCalls: CrossContractCall[],
  ): Promise<string> {
    const normalizedEncryptionKey = this.normalizeEncryptionKey(encryptionKey);
    await this.enableSnarkJSProver();

    const relayAdaptUnshieldNFTAmounts: RailgunNFTAmount[] = [];
    const relayAdaptShieldERC20Recipients: RailgunERC20Recipient[] = [];
    const relayAdaptShieldNFTRecipients: RailgunNFTAmountRecipient[] = [];
    const sendWithPublicWallet = true;
    const dummyGasDetails = await this.getGasDetailsForTransaction(
      TEST_NETWORK,
      1_500_000n,
      sendWithPublicWallet,
      publicWallet,
    );

    const gasEstimateResponse = await WalletSDK.gasEstimateForUnprovenCrossContractCalls(
      TXIDVersion.V2_PoseidonMerkle,
      TEST_NETWORK,
      walletID,
      normalizedEncryptionKey,
      relayAdaptUnshieldERC20Amounts,
      relayAdaptUnshieldNFTAmounts,
      relayAdaptShieldERC20Recipients,
      relayAdaptShieldNFTRecipients,
      crossContractCalls as any,
      dummyGasDetails,
      undefined,
      sendWithPublicWallet,
      undefined,
    );

    const gasDetails = await this.getGasDetailsForTransaction(
      TEST_NETWORK,
      gasEstimateResponse.gasEstimate,
      sendWithPublicWallet,
      publicWallet,
    );

    await WalletSDK.generateCrossContractCallsProof(
      TXIDVersion.V2_PoseidonMerkle,
      TEST_NETWORK,
      walletID,
      normalizedEncryptionKey,
      relayAdaptUnshieldERC20Amounts,
      relayAdaptUnshieldNFTAmounts,
      relayAdaptShieldERC20Recipients,
      relayAdaptShieldNFTRecipients,
      crossContractCalls as any,
      undefined,
      sendWithPublicWallet,
      undefined,
      undefined,
      () => undefined,
    );

    const { transaction } = await WalletSDK.populateProvedCrossContractCalls(
      TXIDVersion.V2_PoseidonMerkle,
      TEST_NETWORK,
      walletID,
      relayAdaptUnshieldERC20Amounts,
      relayAdaptUnshieldNFTAmounts,
      relayAdaptShieldERC20Recipients,
      relayAdaptShieldNFTRecipients,
      crossContractCalls as any,
      undefined,
      sendWithPublicWallet,
      undefined,
      gasDetails,
    );

    const txResponse = await publicWallet.sendTransaction(transaction as any);
    await txResponse.wait();
    return txResponse.hash;
  }

  async privateSupply(params: {
    walletID: string;
    encryptionKey: string;
    publicWallet: Signer;
    adapterAddress: string;
    tokenAddress: string;
    amount: bigint;
    zkOwnerHash: string;
    withdrawAuthHash: string;
  }): Promise<string> {
    const { walletID, encryptionKey, publicWallet, adapterAddress, tokenAddress, amount, zkOwnerHash, withdrawAuthHash } =
      params;
    if (amount <= 0n) {
      throw new Error('Supply amount must be > 0.');
    }

    const coder = AbiCoder.defaultAbiCoder();
    const supplyRequestData = coder.encode(['tuple(bytes32,bytes32)'], [[zkOwnerHash, withdrawAuthHash]]);
    const transferToAdapterData = ERC20_INTERFACE.encodeFunctionData('transfer', [adapterAddress, amount]);

    const onUnshieldData = ADAPTER_INTERFACE.encodeFunctionData('onRailgunUnshield', [
      tokenAddress,
      amount,
      supplyRequestData,
    ]);

    return this.sendCrossContractRailgunTx(
      walletID,
      encryptionKey,
      publicWallet,
      [{ tokenAddress, amount }],
      [
        { to: tokenAddress, data: transferToAdapterData, value: 0n },
        { to: adapterAddress, data: onUnshieldData, value: 0n },
      ],
    );
  }

  async privateWithdraw(params: {
    walletID: string;
    encryptionKey: string;
    publicWallet: Signer;
    adapterAddress: string;
    positionId: bigint;
    amount: bigint;
    withdrawAuthSecret: string;
    nextWithdrawAuthHash: string;
  }): Promise<string> {
    const {
      walletID,
      encryptionKey,
      publicWallet,
      adapterAddress,
      positionId,
      amount,
      withdrawAuthSecret,
      nextWithdrawAuthHash,
    } = params;

    const withdrawData = ADAPTER_INTERFACE.encodeFunctionData('withdrawAndShield', [
      positionId,
      amount,
      withdrawAuthSecret,
      nextWithdrawAuthHash,
    ]);

    return this.sendCrossContractRailgunTx(walletID, encryptionKey, publicWallet, [], [
      { to: adapterAddress, data: withdrawData, value: 0n },
    ]);
  }
}
