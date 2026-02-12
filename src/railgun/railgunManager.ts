import * as WalletSDK from '@railgun-community/wallet';
import {
  EVMGasType,
  NetworkName,
  NETWORK_CONFIG,
  TXIDVersion,
  getEVMGasTypeForTransaction,
  type FallbackProviderJsonConfig,
  type RailgunERC20AmountRecipient,
  type TransactionGasDetails,
} from '@railgun-community/shared-models';
import { HDNodeWallet, Wallet, keccak256 } from 'ethers';

import { TEST_NETWORK, TEST_RPC_URL, TEST_USDC_ADDRESS } from './railgunConstants';
import { createBrowserArtifactStore, createWebDatabase } from './railgunStorage';

export class RailgunManager {
  private initialized = false;

  private normalizeNetworkConfigForInit(networkName: NetworkName): void {
    const config = NETWORK_CONFIG[networkName] as any;
    if (!config) return;

    // Defensive fallback for shared-models network metadata inconsistencies.
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
      if (
        error.message.includes('UNCONFIGURED_NAME') ||
        error.message.includes('value=""')
      ) {
        return new Error(
          `Railgun init failed due to empty contract addresses for ${TEST_NETWORK} in shared-models. Retry \`init-railgun\` with a valid RPC.`,
        );
      }

      if (
        error.message.includes('Batch of more than 3 requests are not allowed on free tier') ||
        error.message.includes('code=SERVER_ERROR')
      ) {
        return new Error(
          `RPC rejected batched JSON-RPC requests for ${TEST_NETWORK}. Use \`set-rpc <url>\` with an endpoint that supports batching.`,
        );
      }

      return error;
    }

    return new Error('Unknown Railgun init error.');
  }

  async initEngine(): Promise<void> {
    if (this.initialized) return;
    if (!TEST_RPC_URL) {
      throw new Error('Missing Railgun RPC URL. Set VITE_RAILGUN_RPC or use CLI command `set-rpc`.');
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
      await this.loadEngineProvider(TEST_NETWORK, TEST_RPC_URL);
    } catch (error) {
      throw this.mapInitError(error);
    }

    this.initialized = true;
  }

  async createWallet(mnemonic: string): Promise<string> {
    const encryptionKey = '0000000000000000000000000000000000000000000000000000000000000000';
    const railgunWalletInfo = await WalletSDK.createRailgunWallet(encryptionKey, mnemonic, {});
    return railgunWalletInfo.railgunAddress;
  }

  // Needed later for private tx proofs. Not required for shield-only flows.
  async enableSnarkJSProver(): Promise<void> {
    const snarkjs = await import('snarkjs');
    WalletSDK.getProver().setSnarkJSGroth16(snarkjs.groth16 as any);
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await WalletSDK.stopRailgunEngine();
    this.initialized = false;
  }

  async loadEngineProvider(networkName: NetworkName, rpcUrl: string): Promise<void> {
    const config: FallbackProviderJsonConfig = {
      chainId: NETWORK_CONFIG[networkName].chain.id,
      providers: [{ provider: rpcUrl, priority: 1, weight: 2, stallTimeout: 2000 }],
    };

    await WalletSDK.loadProvider(config, networkName, 10_000);
  }

  private getConnectedProvider(wallet: Wallet | HDNodeWallet) {
    const provider = wallet.provider;
    if (!provider) {
      throw new Error('Public wallet must be connected to an RPC provider.');
    }
    return provider;
  }

  private async getShieldSignature(wallet: Wallet | HDNodeWallet): Promise<string> {
    const message = WalletSDK.getShieldPrivateKeySignatureMessage();
    const signature = await wallet.signMessage(message);
    return keccak256(signature);
  }

  private async getGasDetailsForTransaction(
    networkName: NetworkName,
    gasEstimate: bigint,
    sendWithPublicWallet: boolean,
    wallet: Wallet | HDNodeWallet,
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
    publicWallet: Wallet | HDNodeWallet,
    amount: bigint,
  ): Promise<string> {
    this.getConnectedProvider(publicWallet);
    if (TEST_USDC_ADDRESS === '0xYOUR_USDC_ADDRESS') {
      throw new Error(
        'USDC token is not configured. Set VITE_USDC_ADDRESS (or legacy fallback keys) or use CLI command `set-usdc`.',
      );
    }

    const erc20AmountRecipients = [
      this.serializeERC20Transfer(TEST_USDC_ADDRESS, amount, railgunWalletAddress),
    ];

    const shieldPrivateKey = await this.getShieldSignature(publicWallet);

    const { gasEstimate } = await WalletSDK.gasEstimateForShield(
      TXIDVersion.V2_PoseidonMerkle,
      TEST_NETWORK,
      shieldPrivateKey,
      erc20AmountRecipients,
      [],
      publicWallet.address,
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
}
