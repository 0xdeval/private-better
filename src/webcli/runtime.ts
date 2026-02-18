import { Contract, ethers } from 'ethers';
import {
  ExternalActionId,
  convertEmporiumOpToCallInfo,
  emporiumOp,
  getFlatFees,
} from '@hinkal/common';

import {
  PRIVATE_CHAIN,
  PRIVATE_CHAIN_PARAMS,
  PRIVATE_EMPORIUM_ADDRESS,
  PRIVATE_NETWORK,
  PRIVATE_RPC_URL,
  PRIVATE_SUPPLY_ADAPTER_ADDRESS,
  SUPPLY_TOKEN_ADDRESS,
} from '../privacy/constants';
import { HinkalManager } from '../privacy/hinkalManager';
import {
  clearLegacyRailgunStorage,
  savePrivacySession,
  type PrivacyLocalSession,
} from '../privacy/privacySession';
import {
  formatTokenAmount,
  parseTokenAmount,
} from './amounts';
import { DEFAULT_PRIVATE_FEE_BUFFER_BPS, FEE_BPS_DENOMINATOR, DEFAULT_PRIVATE_FEE_BUFFER_MIN } from './constants';
import type {
  ActivePrivacySession,
  EthereumProvider,
  EthereumRpcError,
  FeeReserve,
  LineType,
  SignerContext,
} from './types';

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export class WebCliRuntime {
  readonly manager = new HinkalManager();

  private privacySession: ActivePrivacySession | null = null;
  private legacyStoragePurged = false;
  private terminalEl: HTMLElement;

  constructor(terminalEl: HTMLElement) {
    this.terminalEl = terminalEl;
  }

  write(msg: string, type: LineType = 'normal') {
    const line = document.createElement('div');
    line.textContent = msg;
    if (type === 'muted') line.className = 'line-muted';
    if (type === 'ok') line.className = 'line-ok';
    if (type === 'err') line.className = 'line-err';
    this.terminalEl.appendChild(line);
    this.terminalEl.scrollTop = this.terminalEl.scrollHeight;
  }

  clear = () => {
    this.terminalEl.innerHTML = '';
  };

  printStartup() {
    this.write('Private Better Web CLI ready. Type `help`.', 'ok');
    this.write(`Network: ${PRIVATE_NETWORK}`, 'muted');
    this.write('Quick start:', 'muted');
    this.write('1) login -> login to private wallet', 'muted');
    this.write('2) approve 1 -> approve token to Hinkal shield contract', 'muted');
    this.write('3) shield 1 -> shield token to private balance', 'muted');
    this.write('4) unshield 1 -> unshield token to public wallet', 'muted');
    this.write('5) private-balance -> show spendable private token balance', 'muted');
    this.write('6) private-supply 1 -> create private supply position on Aave', 'muted');
    this.write(
      '7) private-withdraw <positionId> <amount|max> -> withdraw from Aave position to private balance',
      'muted',
    );
  }

  isDebugEnabled(): boolean {
    const raw = env?.VITE_PRIVATE_DEBUG;
    if (raw == null) return false;
    const normalized = raw.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  debug(message: string) {
    if (!this.isDebugEnabled()) return;
    this.write(`[debug] ${message}`, 'muted');
  }

  private getProviderLabel(provider: EthereumProvider): string {
    if (provider.isRabby) return 'Rabby';
    if (provider.isMetaMask) return 'MetaMask';
    if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
    const flags = Object.entries(provider)
      .filter(([key, value]) => key.startsWith('is') && value === true)
      .map(([key]) => key)
      .join(', ');
    return flags ? `Injected (${flags})` : 'Injected wallet';
  }

  private getEthereumProvider(): EthereumProvider {
    const win = window as Window & {
      ethereum?: EthereumProvider;
      coinbaseWalletExtension?: { ethereum?: EthereumProvider };
    };

    const candidates: EthereumProvider[] = [];

    if (win.ethereum) {
      if (Array.isArray(win.ethereum.providers) && win.ethereum.providers.length > 0) {
        candidates.push(...win.ethereum.providers);
      }
      candidates.push(win.ethereum);
    }

    if (win.coinbaseWalletExtension?.ethereum) {
      candidates.push(win.coinbaseWalletExtension.ethereum);
    }

    const providers = Array.from(new Set(candidates));
    const preferred =
      providers.find((provider) => provider.isRabby) ??
      providers.find((provider) => provider.isMetaMask) ??
      providers.find((provider) => provider.isCoinbaseWallet) ??
      providers[0];

    if (!preferred) {
      throw new Error(
        'No injected wallet found. Install MetaMask/Coinbase Wallet in this browser profile and enable site access for http://localhost:3017.',
      );
    }

    return preferred;
  }

  async getSigner(): Promise<SignerContext> {
    const eth = this.getEthereumProvider();
    await eth.request({ method: 'eth_requestAccounts' });

    const provider = new ethers.providers.Web3Provider(eth as any);
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();
    const providerLabel = this.getProviderLabel(eth);
    return { provider, signerAddress, providerLabel };
  }

  async ensureTargetNetwork() {
    const eth = this.getEthereumProvider();
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: PRIVATE_CHAIN.chainIdHex }],
      });
    } catch (error) {
      const rpcError = error as EthereumRpcError;
      if (rpcError.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [PRIVATE_CHAIN_PARAMS],
        });
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: PRIVATE_CHAIN.chainIdHex }],
        });
        return;
      }
      throw error;
    }
  }

  private isAddress(value: string | undefined): value is string {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
  }

  private requireEnvAddress(key: string, value: string): string {
    if (!value) {
      throw new Error(`Missing env key: ${key}`);
    }
    if (!this.isAddress(value)) {
      throw new Error(`Invalid address in env key ${key}: ${value}`);
    }
    return value;
  }

  getSupplyTokenAddress(): string {
    return this.requireEnvAddress('VITE_SUPPLY_TOKEN', SUPPLY_TOKEN_ADDRESS);
  }

  getAdapterAddress(): string {
    return this.requireEnvAddress('VITE_PRIVATE_SUPPLY_ADAPTER', PRIVATE_SUPPLY_ADAPTER_ADDRESS);
  }

  getEmporiumAddress(): string {
    return this.requireEnvAddress('VITE_PRIVATE_EMPORIUM', PRIVATE_EMPORIUM_ADDRESS);
  }

  private getPrivateFeeBufferBps(): bigint {
    const raw = env?.VITE_PRIVATE_FEE_BUFFER_BPS;
    if (!raw) return DEFAULT_PRIVATE_FEE_BUFFER_BPS;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
      this.debug(`Invalid VITE_PRIVATE_FEE_BUFFER_BPS="${raw}". Using default.`);
      return DEFAULT_PRIVATE_FEE_BUFFER_BPS;
    }
    return BigInt(parsed);
  }

  private getPrivateFeeBufferMin(): bigint {
    const raw = env?.VITE_PRIVATE_FEE_BUFFER_MIN;
    if (!raw) return DEFAULT_PRIVATE_FEE_BUFFER_MIN;
    try {
      return parseTokenAmount(raw);
    } catch {
      this.debug(`Invalid VITE_PRIVATE_FEE_BUFFER_MIN="${raw}". Using default.`);
      return DEFAULT_PRIVATE_FEE_BUFFER_MIN;
    }
  }

  getBufferedFeeReserve(flatFee: bigint): FeeReserve {
    const bps = this.getPrivateFeeBufferBps();
    const minBuffer = this.getPrivateFeeBufferMin();
    const bpsBuffer = (flatFee * bps) / FEE_BPS_DENOMINATOR;
    const usedBuffer = bpsBuffer > minBuffer ? bpsBuffer : minBuffer;
    return {
      reserve: flatFee + usedBuffer,
      bpsBuffer,
      minBuffer,
      usedBuffer,
    };
  }

  buildPrivateSupplyOps(params: {
    adapterAddress: string;
    tokenAddress: string;
    amount: bigint;
    zkOwnerHash: string;
    withdrawAuthHash: string;
  }): string[] {
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

    return [
      emporiumOp({
        contract: params.tokenAddress,
        callDataString: erc20Interface.encodeFunctionData('transfer', [
          params.adapterAddress,
          params.amount,
        ]),
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
  }

  buildPrivateWithdrawOps(params: {
    adapterAddress: string;
    emporiumAddress: string;
    positionId: bigint;
    amount: bigint;
    withdrawAuthSecret: string;
    nextWithdrawAuthHash: string;
  }): string[] {
    const adapterInterface = new ethers.utils.Interface([
      'function withdrawToRecipient(uint256 positionId, uint256 amount, bytes32 withdrawAuthSecret, bytes32 nextWithdrawAuthHash, address recipient) returns (uint256)',
    ]);
    return [
      emporiumOp({
        contract: params.adapterAddress,
        callDataString: adapterInterface.encodeFunctionData('withdrawToRecipient', [
          params.positionId,
          params.amount,
          params.withdrawAuthSecret,
          params.nextWithdrawAuthHash,
          params.emporiumAddress,
        ]),
      }),
    ];
  }

  async estimateEmporiumFlatFee(params: {
    walletAddress: string;
    feeTokenAddress: string;
    erc20Addresses: string[];
    ops: string[];
  }): Promise<bigint | null> {
    try {
      const callInfos = params.ops.map((op) =>
        convertEmporiumOpToCallInfo(op, params.walletAddress, PRIVATE_CHAIN.chainId),
      );
      const feeInfo = await getFlatFees(
        PRIVATE_CHAIN.chainId,
        params.erc20Addresses,
        ExternalActionId.Emporium,
        params.erc20Addresses.map(() => 1n),
        params.feeTokenAddress,
        callInfos,
      );
      const explicitFlatFee = feeInfo.flatFees.find((value) => value > 0n) ?? feeInfo.flatFees[0];
      if (explicitFlatFee != null && explicitFlatFee > 0n) {
        return explicitFlatFee;
      }
      if (feeInfo.priceOfTransactionInToken != null && feeInfo.priceOfTransactionInToken > 0n) {
        return feeInfo.priceOfTransactionInToken;
      }
      throw new Error('fee estimate resolved to zero');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.debug(`fee-estimate unavailable: ${message}`);
      return null;
    }
  }

  addressesEqual(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  async ensurePrivacyInitialized(): Promise<void> {
    if (!this.legacyStoragePurged) {
      await clearLegacyRailgunStorage();
      this.legacyStoragePurged = true;
    }

    if (!PRIVATE_RPC_URL) {
      throw new Error('Missing env key: VITE_PRIVATE_RPC');
    }
    await this.manager.initEngine(PRIVATE_RPC_URL, PRIVATE_NETWORK);
  }

  async deriveSessionKey(
    provider: ethers.providers.Web3Provider,
    signerAddress: string,
  ): Promise<{ chainId: bigint; sessionKeyHex: string }> {
    const signer = provider.getSigner(signerAddress);
    const network = await provider.getNetwork();
    const chainId = network.chainId;
    const message = `Private Better Privacy Session v1\nChain:${chainId}\nAddress:${signerAddress.toLowerCase()}`;
    const signature = await signer.signMessage(message);
    return { chainId: BigInt(chainId), sessionKeyHex: ethers.utils.keccak256(signature) };
  }

  async getBoundSigner(
    provider: ethers.providers.Web3Provider,
    expectedAddress: string,
  ): Promise<ethers.providers.JsonRpcSigner> {
    const signer = provider.getSigner(expectedAddress);
    const actualAddress = await signer.getAddress();
    if (!this.addressesEqual(actualAddress, expectedAddress)) {
      throw new Error(
        `Wallet signer mismatch. Expected ${expectedAddress}, got ${actualAddress}. Switch active wallet account in Rabby and retry.`,
      );
    }
    return signer;
  }

  getZkOwnerHash(privateAddress: string): string {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(privateAddress.toLowerCase()));
  }

  requireActiveSession(): ActivePrivacySession {
    if (!this.privacySession) {
      throw new Error('No active private session. Run `login` first.');
    }
    return this.privacySession;
  }

  setActiveSession(session: ActivePrivacySession | null) {
    this.privacySession = session;
  }

  assertSessionEoa(session: ActivePrivacySession, signerAddress: string) {
    if (!this.addressesEqual(session.eoaAddress, signerAddress)) {
      throw new Error(
        `Active privacy session belongs to ${session.eoaAddress}, but wallet signer is ${signerAddress}. Run login again with the same EOA.`,
      );
    }
  }

  async saveActiveSession(): Promise<void> {
    const session = this.requireActiveSession();
    const payload: PrivacyLocalSession = {
      privateAddress: session.privateAddress,
      mnemonic: session.mnemonic,
      positionSecrets: session.positionSecrets,
      updatedAt: Date.now(),
    };
    await savePrivacySession(session.chainId, session.eoaAddress, session.sessionKeyHex, payload);
  }

  async validatePrivateSupplyConfig(
    provider: ethers.providers.Web3Provider,
    adapterAddress: string,
    tokenAddress: string,
    emporiumAddress: string,
  ): Promise<void> {
    const network = await provider.getNetwork();
    if (network.chainId !== PRIVATE_CHAIN.chainId) {
      throw new Error(
        `Wrong chain for private-supply. Expected ${PRIVATE_CHAIN.chainId}, got ${network.chainId}.`,
      );
    }

    const adapter = new Contract(adapterAddress, [
      'function privacyExecutor() view returns (address)',
      'function supplyToken() view returns (address)',
    ], provider) as any;
    const [configuredExecutor, configuredToken] = await Promise.all([
      adapter.privacyExecutor(),
      adapter.supplyToken(),
    ]);

    if (!this.addressesEqual(configuredExecutor, emporiumAddress)) {
      throw new Error(
        `Adapter privacyExecutor mismatch. Expected Emporium ${emporiumAddress}, got ${configuredExecutor}. Update adapter via setPrivacyExecutor(address).`,
      );
    }
    if (!this.addressesEqual(configuredToken, tokenAddress)) {
      throw new Error(`Adapter token mismatch. Expected ${tokenAddress}, got ${configuredToken}.`);
    }
  }

  formatError(error: unknown): string {
    if (error instanceof Error) {
      const maybeRpcError = error as Error & EthereumRpcError;
      if (typeof maybeRpcError.code === 'number') {
        return `${error.message} (code ${maybeRpcError.code})`;
      }
      return error.message;
    }

    if (error && typeof error === 'object') {
      const maybeRpcError = error as EthereumRpcError;
      const message =
        typeof maybeRpcError.message === 'string' ? maybeRpcError.message : JSON.stringify(error);
      if (typeof maybeRpcError.code === 'number') {
        return `${message} (code ${maybeRpcError.code})`;
      }
      return message;
    }

    return String(error);
  }

  debugFeeEstimate(label: string, flatFee: bigint, reserve: bigint, required?: bigint) {
    const requiredPart = required == null ? '' : ` required=${formatTokenAmount(required)}`;
    this.debug(
      `${label}: flatFee=${formatTokenAmount(flatFee)} reserve=${formatTokenAmount(reserve)}${requiredPart}`,
    );
  }
}
