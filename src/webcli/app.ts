import {
  BigNumber,
  Contract,
  ethers,
  Wallet,
} from 'ethers';
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
} from '../privacy/privacyConstants';
import { HinkalManager } from '../privacy/hinkalManager';
import {
  clearLegacyRailgunStorage,
  loadPrivacySession,
  savePrivacySession,
  type PrivacyLocalSession,
} from '../privacy/privacySession';

type LineType = 'normal' | 'ok' | 'err' | 'muted';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  isRabby?: boolean;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: EthereumProvider[];
};

type EthereumRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type CommandContext = {
  manager: HinkalManager;
  getSigner: () => Promise<{
    provider: ethers.providers.Web3Provider;
    signerAddress: string;
    providerLabel: string;
  }>;
  write: (msg: string, type?: LineType) => void;
  clear: () => void;
};

type ActivePrivacySession = {
  privateAddress: string;
  mnemonic: string;
  positionSecrets: Record<string, string>;
  sessionKeyHex: string;
  eoaAddress: string;
  chainId: bigint;
};

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
] as const;

const ADAPTER_ABI = [
  'function nextPositionId() view returns (uint256)',
  'function privacyExecutor() view returns (address)',
  'function supplyToken() view returns (address)',
  'function positions(uint256) view returns (bytes32 zkOwnerHash, address vault, address token, uint256 amount, bytes32 withdrawAuthHash)',
  'function getOwnerPositionIds(bytes32 zkOwnerHash, uint256 offset, uint256 limit) view returns (uint256[] ids, uint256 total)',
] as const;

const TOKEN_DECIMALS = 6;
const FEE_BPS_DENOMINATOR = 10_000n;
const DEFAULT_PRIVATE_FEE_BUFFER_BPS = 2_000n; // 20%
const DEFAULT_PRIVATE_FEE_BUFFER_MIN = BigInt(
  ethers.utils.parseUnits('0.002', TOKEN_DECIMALS).toString(),
);
const DEFAULT_TEST_MNEMONIC =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_PRIVATE_TEST_MNEMONIC;

const parseTokenAmount = (amountText: string): bigint =>
  BigInt(ethers.utils.parseUnits(amountText, TOKEN_DECIMALS).toString());

const formatTokenAmount = (amount: BigNumber | bigint): string =>
  ethers.utils.formatUnits(amount.toString(), TOKEN_DECIMALS);

class WebCLI {
  private terminalEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private history: string[] = [];
  private historyIndex = -1;
  private manager = new HinkalManager();
  private privacySession: ActivePrivacySession | null = null;
  private legacyStoragePurged = false;

  constructor(terminalEl: HTMLElement, inputEl: HTMLInputElement) {
    this.terminalEl = terminalEl;
    this.inputEl = inputEl;

    this.write('Private Better Web CLI ready. Type `help`.', 'ok');
    this.write(`Network: ${PRIVATE_NETWORK}`, 'muted');
    this.write('Quick start:', 'muted');
    this.write('1) privacy-login -> login to private wallet', 'muted');
    this.write('2) approve-token 1 -> approve token to Hinkal shield contract', 'muted');
    this.write('3) shield-token 1 -> shield token to private balance', 'muted');
    this.write('4) unshield-token 1 -> unshield token to public wallet', 'muted');
    this.write('5) private-balance -> show spendable private token balance', 'muted');
    this.write('6) private-supply 1 -> create private supply position on Aave', 'muted');
    this.write(
      '7) private-withdraw <positionId> <amount|max> -> withdraw from Aave position to private balance',
      'muted',
    );
    this.bindInput();
  }

  private bindInput() {
    this.inputEl.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        const raw = this.inputEl.value.trim();
        this.inputEl.value = '';
        if (!raw) return;

        this.history.push(raw);
        this.historyIndex = this.history.length;
        this.write(`pb> ${raw}`, 'muted');
        await this.execute(raw);
      }

      if (event.key === 'ArrowUp') {
        if (this.history.length === 0) return;
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        this.inputEl.value = this.history[this.historyIndex] ?? '';
        event.preventDefault();
      }

      if (event.key === 'ArrowDown') {
        if (this.history.length === 0) return;
        this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
        this.inputEl.value = this.history[this.historyIndex] ?? '';
        event.preventDefault();
      }
    });
  }

  private write(msg: string, type: LineType = 'normal') {
    const line = document.createElement('div');
    line.textContent = msg;
    if (type === 'muted') line.className = 'line-muted';
    if (type === 'ok') line.className = 'line-ok';
    if (type === 'err') line.className = 'line-err';
    this.terminalEl.appendChild(line);
    this.terminalEl.scrollTop = this.terminalEl.scrollHeight;
  }

  private clear = () => {
    this.terminalEl.innerHTML = '';
  };

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

  private async getSigner(): Promise<{
    provider: ethers.providers.Web3Provider;
    signerAddress: string;
    providerLabel: string;
  }> {
    const eth = this.getEthereumProvider();
    await eth.request({ method: 'eth_requestAccounts' });

    const provider = new ethers.providers.Web3Provider(eth as any);
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();
    const providerLabel = this.getProviderLabel(eth);
    const network = await provider.getNetwork();
    this.debug(`wallet signer=${signerAddress} provider=${providerLabel} chainId=${network.chainId}`);
    return { provider, signerAddress, providerLabel };
  }

  private async ensureTargetNetwork() {
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

  private getConfig() {
    const win = window as Window & {
      __APP_CONFIG__?: {
        PRIVATE_NETWORK?: string;
        PRIVATE_RPC?: string;
        PRIVATE_EMPORIUM?: string;
        PRIVATE_SUPPLY_ADAPTER?: string;
        SUPPLY_TOKEN?: string;
        PRIVATE_DEBUG?: string;
        PRIVATE_FEE_BUFFER_BPS?: string;
        PRIVATE_FEE_BUFFER_MIN?: string;
      };
    };
    return win.__APP_CONFIG__ ?? {};
  }

  private isDebugEnabled(): boolean {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const raw = this.getConfig().PRIVATE_DEBUG ?? env?.VITE_PRIVATE_DEBUG;
    if (raw == null) return true;
    const normalized = raw.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  private debug(message: string) {
    if (!this.isDebugEnabled()) return;
    this.write(`[debug] ${message}`, 'muted');
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

  private getSupplyTokenAddress(): string {
    const value = this.getConfig().SUPPLY_TOKEN ?? SUPPLY_TOKEN_ADDRESS;
    return this.requireEnvAddress('VITE_SUPPLY_TOKEN', value);
  }

  private getAdapterAddress(): string {
    const value = this.getConfig().PRIVATE_SUPPLY_ADAPTER ?? PRIVATE_SUPPLY_ADAPTER_ADDRESS;
    return this.requireEnvAddress('VITE_PRIVATE_SUPPLY_ADAPTER', value);
  }

  private getEmporiumAddress(): string {
    const value = this.getConfig().PRIVATE_EMPORIUM ?? PRIVATE_EMPORIUM_ADDRESS;
    return this.requireEnvAddress('VITE_PRIVATE_EMPORIUM', value);
  }

  private getPrivateFeeBufferBps(): bigint {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const raw = this.getConfig().PRIVATE_FEE_BUFFER_BPS ?? env?.VITE_PRIVATE_FEE_BUFFER_BPS;
    if (!raw) return DEFAULT_PRIVATE_FEE_BUFFER_BPS;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
      this.debug(`Invalid VITE_PRIVATE_FEE_BUFFER_BPS="${raw}". Using default ${DEFAULT_PRIVATE_FEE_BUFFER_BPS.toString()}.`);
      return DEFAULT_PRIVATE_FEE_BUFFER_BPS;
    }
    return BigInt(parsed);
  }

  private getPrivateFeeBufferMin(): bigint {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const raw = this.getConfig().PRIVATE_FEE_BUFFER_MIN ?? env?.VITE_PRIVATE_FEE_BUFFER_MIN;
    if (!raw) return DEFAULT_PRIVATE_FEE_BUFFER_MIN;
    try {
      return parseTokenAmount(raw);
    } catch {
      this.debug(`Invalid VITE_PRIVATE_FEE_BUFFER_MIN="${raw}". Using default ${formatTokenAmount(DEFAULT_PRIVATE_FEE_BUFFER_MIN)}.`);
      return DEFAULT_PRIVATE_FEE_BUFFER_MIN;
    }
  }

  private getBufferedFeeReserve(flatFee: bigint): {
    reserve: bigint;
    bpsBuffer: bigint;
    minBuffer: bigint;
    usedBuffer: bigint;
  } {
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

  private buildPrivateSupplyOps(params: {
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

  private buildPrivateWithdrawOps(params: {
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

  private async estimateEmporiumFlatFee(params: {
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

  private addressesEqual(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  private async ensurePrivacyInitialized(): Promise<void> {
    if (!this.legacyStoragePurged) {
      await clearLegacyRailgunStorage();
      this.legacyStoragePurged = true;
    }

    const config = this.getConfig();
    const rpc = config.PRIVATE_RPC ?? PRIVATE_RPC_URL;
    if (!rpc) {
      throw new Error('Missing env key: VITE_PRIVATE_RPC');
    }
    await this.manager.initEngine(rpc, PRIVATE_NETWORK);
  }

  private async deriveSessionKey(
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

  private async getBoundSigner(
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

  private getZkOwnerHash(privateAddress: string): string {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(privateAddress.toLowerCase()));
  }

  private requireActiveSession(): ActivePrivacySession {
    if (!this.privacySession) {
      throw new Error('No active private session. Run `privacy-login` first.');
    }
    return this.privacySession;
  }

  private assertSessionEoa(session: ActivePrivacySession, signerAddress: string) {
    if (!this.addressesEqual(session.eoaAddress, signerAddress)) {
      throw new Error(
        `Active privacy session belongs to ${session.eoaAddress}, but wallet signer is ${signerAddress}. Run privacy-login again with the same EOA.`,
      );
    }
  }

  private async saveActiveSession(): Promise<void> {
    const session = this.requireActiveSession();
    const payload: PrivacyLocalSession = {
      privateAddress: session.privateAddress,
      mnemonic: session.mnemonic,
      positionSecrets: session.positionSecrets,
      updatedAt: Date.now(),
    };
    await savePrivacySession(session.chainId, session.eoaAddress, session.sessionKeyHex, payload);
  }

  private async validatePrivateSupplyConfig(
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

    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
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

  private formatError(error: unknown): string {
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

  private async execute(raw: string): Promise<void> {
    const [cmd, ...args] = raw.split(/\s+/);
    const ctx: CommandContext = {
      manager: this.manager,
      getSigner: this.getSigner.bind(this),
      write: this.write.bind(this),
      clear: this.clear,
    };

    try {
      switch (cmd) {
        case 'help':
          this.help();
          return;
        case 'clear':
          ctx.clear();
          return;
        case 'privacy-login':
          await this.privacyLogin(ctx);
          return;
        case 'privacy-import':
          await this.privacyImport(ctx, args.join(' '));
          return;
        case 'approve-token':
          await this.approveToken(ctx, args[0]);
          return;
        case 'shield-token':
          await this.shieldToken(ctx, args[0]);
          return;
        case 'unshield-token':
          await this.unshieldToken(ctx, args[0], args[1]);
          return;
        case 'private-supply':
          await this.privateSupply(ctx, args[0]);
          return;
        case 'private-balance':
          await this.privateBalance(ctx);
          return;
        case 'show-positions':
          await this.showPositions(ctx);
          return;
        case 'private-withdraw':
          await this.privateWithdraw(ctx, args[0], args[1]);
          return;
        default:
          this.write(`Unknown command: ${cmd}. Type help.`, 'err');
      }
    } catch (error) {
      this.write(`Error: ${this.formatError(error)}`, 'err');
    }
  }

  private help() {
    this.write('Commands:', 'muted');
    this.write('help');
    this.write('clear');
    this.write('privacy-login');
    this.write('privacy-import <mnemonic>');
    this.write('approve-token <amount>   e.g. approve-token 1.5');
    this.write('shield-token <amount>   e.g. shield-token 1.5');
    this.write('unshield-token <amount> [recipient]   e.g. unshield-token 0.5');
    this.write('private-balance');
    this.write('private-supply <amount>   e.g. private-supply 1.0');
    this.write('show-positions');
    this.write(
      'private-withdraw <positionId> <amount|max>   e.g. private-withdraw 1 max (to private balance)',
    );
  }

  private async privacyLogin(ctx: CommandContext) {
    await this.ensureTargetNetwork();
    const { provider, signerAddress } = await ctx.getSigner();
    ctx.write('Please sign the session message in your wallet...', 'muted');
    const { chainId, sessionKeyHex } = await this.deriveSessionKey(provider, signerAddress);
    await this.ensurePrivacyInitialized();

    const stored = await loadPrivacySession(chainId, signerAddress, sessionKeyHex);
    if (stored) {
      this.privacySession = {
        privateAddress: stored.privateAddress,
        mnemonic: stored.mnemonic,
        positionSecrets: stored.positionSecrets ?? {},
        sessionKeyHex,
        eoaAddress: signerAddress,
        chainId,
      };
      this.debug(
        `privacy-login loaded: private=${stored.privateAddress} eoa=${signerAddress} chainId=${chainId.toString()}`,
      );
      ctx.write(`Private account loaded: ${stored.privateAddress}`, 'ok');
      return;
    }

    const mnemonic = DEFAULT_TEST_MNEMONIC ?? Wallet.createRandom().mnemonic?.phrase;
    if (!mnemonic) {
      throw new Error('Could not generate mnemonic.');
    }

    const privateAddress = this.manager.derivePrivateAddress(mnemonic);
    this.privacySession = {
      privateAddress,
      mnemonic,
      positionSecrets: {},
      sessionKeyHex,
      eoaAddress: signerAddress,
      chainId,
    };
    await this.saveActiveSession();
    this.debug(
      `privacy-login created: private=${privateAddress} eoa=${signerAddress} chainId=${chainId.toString()}`,
    );
    ctx.write(`Private account created: ${privateAddress}`, 'ok');
    ctx.write(`Backup mnemonic now (sensitive): ${mnemonic}`, 'muted');
  }

  private async privacyImport(ctx: CommandContext, mnemonic: string) {
    if (!mnemonic) {
      throw new Error('Usage: privacy-import <mnemonic>');
    }
    await this.ensureTargetNetwork();
    const { provider, signerAddress } = await ctx.getSigner();
    ctx.write('Please sign the session message in your wallet...', 'muted');
    const { chainId, sessionKeyHex } = await this.deriveSessionKey(provider, signerAddress);
    await this.ensurePrivacyInitialized();

    const privateAddress = this.manager.derivePrivateAddress(mnemonic);
    this.privacySession = {
      privateAddress,
      mnemonic,
      positionSecrets: {},
      sessionKeyHex,
      eoaAddress: signerAddress,
      chainId,
    };
    await this.saveActiveSession();
    this.debug(
      `privacy-import: private=${privateAddress} eoa=${signerAddress} chainId=${chainId.toString()}`,
    );
    ctx.write(`Private account imported: ${privateAddress}`, 'ok');
  }

  private async approveToken(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) throw new Error('Usage: approve-token <amount>');
    const session = this.requireActiveSession();
    await this.ensureTargetNetwork();
    await this.ensurePrivacyInitialized();
    const { provider, signerAddress } = await ctx.getSigner();
    this.assertSessionEoa(session, signerAddress);
    const signer = await this.getBoundSigner(provider, signerAddress);

    const amount = ethers.utils.parseUnits(amountText, TOKEN_DECIMALS);
    const token = this.getSupplyTokenAddress();
    const spender = await this.manager.getShieldSpender({
      mnemonic: session.mnemonic,
      publicWallet: signer,
    });

    const erc20 = new Contract(token, ERC20_ABI, signer) as any;
    const [balanceBefore, allowanceBefore] = await Promise.all([
      erc20.balanceOf(signerAddress),
      erc20.allowance(signerAddress, spender),
    ]);
    this.debug(
      `approve-token: eoa=${signerAddress} private=${session.privateAddress} token=${token} spender=${spender} amount=${amountText}`,
    );
    this.debug(
      `approve-token before: publicBalance=${formatTokenAmount(balanceBefore)} allowanceToSpender=${formatTokenAmount(allowanceBefore)}`,
    );
    const tx = await erc20.approve(spender, amount);
    ctx.write(`Approve submitted: ${tx.hash}`);
    await tx.wait();
    const allowanceAfter = await erc20.allowance(signerAddress, spender);
    this.debug(`approve-token after: allowanceToSpender=${formatTokenAmount(allowanceAfter)}`);
    ctx.write(`Approve confirmed for shield spender: ${spender}`, 'ok');
  }

  private async shieldToken(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) {
      throw new Error('Usage: shield-token <amount>');
    }

    const session = this.requireActiveSession();
    await this.ensureTargetNetwork();
    await this.ensurePrivacyInitialized();
    const { provider, signerAddress } = await ctx.getSigner();
    this.assertSessionEoa(session, signerAddress);
    const signer = await this.getBoundSigner(provider, signerAddress);
    const amount = parseTokenAmount(amountText);
    const tokenAddress = this.getSupplyTokenAddress();
    const spender = await this.manager.getShieldSpender({
      mnemonic: session.mnemonic,
      publicWallet: signer,
    });
    const erc20 = new Contract(tokenAddress, ERC20_ABI, provider) as any;
    const [balanceBefore, allowanceBefore] = await Promise.all([
      erc20.balanceOf(signerAddress),
      erc20.allowance(signerAddress, spender),
    ]);
    this.debug(
      `shield-token: eoa=${signerAddress} private=${session.privateAddress} token=${tokenAddress} spender=${spender} amount=${amountText}`,
    );
    this.debug(
      `shield-token before: publicBalance=${formatTokenAmount(balanceBefore)} allowanceToSpender=${formatTokenAmount(allowanceBefore)}`,
    );

    const txHash = await ctx.manager.shieldToken({
      mnemonic: session.mnemonic,
      tokenAddress,
      amount,
      publicWallet: signer,
    });

    const [balanceAfter, allowanceAfter] = await Promise.all([
      erc20.balanceOf(signerAddress),
      erc20.allowance(signerAddress, spender),
    ]);
    this.debug(
      `shield-token after: publicBalance=${formatTokenAmount(balanceAfter)} allowanceToSpender=${formatTokenAmount(allowanceAfter)}`,
    );
    ctx.write(`Shield confirmed: ${txHash}`, 'ok');
  }

  private async unshieldToken(
    ctx: CommandContext,
    amountText: string | undefined,
    recipientAddress: string | undefined,
  ) {
    if (!amountText) {
      throw new Error('Usage: unshield-token <amount> [recipient]');
    }

    const session = this.requireActiveSession();
    await this.ensureTargetNetwork();
    await this.ensurePrivacyInitialized();
    const { provider, signerAddress } = await ctx.getSigner();
    this.assertSessionEoa(session, signerAddress);
    const signer = await this.getBoundSigner(provider, signerAddress);
    const amount = parseTokenAmount(amountText);
    const tokenAddress = this.getSupplyTokenAddress();
    const recipient = recipientAddress ?? signerAddress;
    this.debug(
      `unshield-token: eoa=${signerAddress} private=${session.privateAddress} token=${tokenAddress} recipient=${recipient} amount=${amountText}`,
    );

    const txHash = await ctx.manager.unshieldToken({
      mnemonic: session.mnemonic,
      tokenAddress,
      amount,
      recipientAddress: recipient,
      publicWallet: signer,
    });
    ctx.write(`Unshield confirmed: ${txHash}`, 'ok');
  }

  private async privateSupply(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) throw new Error('Usage: private-supply <amount>');
    await this.ensureTargetNetwork();
    await this.ensurePrivacyInitialized();

    const session = this.requireActiveSession();
    const amount = parseTokenAmount(amountText);
    const adapterAddress = this.getAdapterAddress();
    const tokenAddress = this.getSupplyTokenAddress();
    const emporiumAddress = this.getEmporiumAddress();

    const { provider, signerAddress } = await ctx.getSigner();
    this.assertSessionEoa(session, signerAddress);
    const signer = await this.getBoundSigner(provider, signerAddress);
    await this.validatePrivateSupplyConfig(provider, adapterAddress, tokenAddress, emporiumAddress);

    this.write('Building private supply transaction...', 'muted');
    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
    const erc20 = new Contract(tokenAddress, ERC20_ABI, provider) as any;
    const spender = await this.manager.getShieldSpender({
      mnemonic: session.mnemonic,
      publicWallet: signer,
    });
    const [publicBalance, allowanceToSpender, adapterExecutor, adapterToken, nativeBalance] = await Promise.all([
      erc20.balanceOf(signerAddress),
      erc20.allowance(signerAddress, spender),
      adapter.privacyExecutor(),
      adapter.supplyToken(),
      provider.getBalance(signerAddress),
    ]);
    const privateSpendableBalance = await this.manager.getPrivateSpendableBalance({
      mnemonic: session.mnemonic,
      tokenAddress,
      publicWallet: signer,
    });
    const privateActionContext = await this.manager.getPrivateActionContext({
      mnemonic: session.mnemonic,
      publicWallet: signer,
    });
    const zkOwnerHash = this.getZkOwnerHash(session.privateAddress);
    this.debug(
      `private-supply: eoa=${signerAddress} private=${session.privateAddress} token=${tokenAddress} amount=${amountText}`,
    );
    this.debug(
      `private-supply contracts: adapter=${adapterAddress} emporiumExpected=${emporiumAddress} adapterPrivacyExecutor=${adapterExecutor} adapterToken=${adapterToken} hinkalSpender=${spender}`,
    );
    this.debug(
      `private-supply preflight: publicBalance=${formatTokenAmount(publicBalance)} allowanceToHinkal=${formatTokenAmount(allowanceToSpender)} privateSpendable=${formatTokenAmount(privateSpendableBalance)} zkOwnerHash=${zkOwnerHash}`,
    );
    this.debug(`private-supply wallet-native: eoaEth=${ethers.utils.formatEther(nativeBalance)}`);
    this.debug(
      `private-supply signer-context: runtimeSigner=${privateActionContext.runtimeSigner ?? 'unknown'} subAccount=${privateActionContext.subAccountAddress} subAccountKey=${privateActionContext.hasSubAccountKey ? 'yes' : 'no'}`,
    );
    if (privateSpendableBalance < amount) {
      throw new Error(
        `Insufficient private spendable balance. Need ${amountText}, available ${formatTokenAmount(privateSpendableBalance)}.`,
      );
    }
    const withdrawAuthSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
    const withdrawAuthHash = ethers.utils.keccak256(withdrawAuthSecret);
    const supplyOps = this.buildPrivateSupplyOps({
      adapterAddress,
      tokenAddress,
      amount,
      zkOwnerHash,
      withdrawAuthHash,
    });
    const estimatedFlatFee = await this.estimateEmporiumFlatFee({
      walletAddress: privateActionContext.subAccountAddress,
      feeTokenAddress: tokenAddress,
      erc20Addresses: [tokenAddress],
      ops: supplyOps,
    });
    if (estimatedFlatFee != null) {
      const { reserve, usedBuffer, bpsBuffer, minBuffer } = this.getBufferedFeeReserve(estimatedFlatFee);
      const requiredTotal = amount + reserve;
      ctx.write(
        `Fee estimate (supply): flatFee=${formatTokenAmount(estimatedFlatFee)} reserve=${formatTokenAmount(reserve)} required=${formatTokenAmount(requiredTotal)}`,
        'muted',
      );
      this.debug(
        `private-supply fee-estimate: flatFee=${formatTokenAmount(estimatedFlatFee)} buffer=${formatTokenAmount(usedBuffer)} reserve=${formatTokenAmount(reserve)} totalRequired=${formatTokenAmount(requiredTotal)} bufferBpsPart=${formatTokenAmount(bpsBuffer)} bufferMin=${formatTokenAmount(minBuffer)}`,
      );
      if (privateSpendableBalance < requiredTotal) {
        throw new Error(
          `Insufficient private spendable balance for supply + fee reserve. Need ${formatTokenAmount(requiredTotal)}, available ${formatTokenAmount(privateSpendableBalance)}.`,
        );
      }
    }

    const beforeIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
    const beforeIds = (beforeIdsRaw[0] as BigNumber[]).map((id) => id.toString());
    const beforeSet = new Set(beforeIds);

    let txHash: string;
    try {
      txHash = await ctx.manager.privateSupply({
        mnemonic: session.mnemonic,
        publicWallet: signer,
        adapterAddress,
        tokenAddress,
        amount,
        zkOwnerHash,
        withdrawAuthHash,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('insufficient funds')) {
        throw new Error(
          `Insufficient private funds for supply + Hinkal fee. Current private spendable=${formatTokenAmount(privateSpendableBalance)}. Try a smaller amount or shield more USDC first.`,
        );
      }
      throw error;
    }
    ctx.write(`Private supply tx: ${txHash}`, 'ok');

    const afterIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
    const afterIds = afterIdsRaw[0] as BigNumber[];
    const createdId = afterIds.find((id) => !beforeSet.has(id.toString())) ?? afterIds.at(-1);
    if (createdId != null) {
      session.positionSecrets[createdId.toString()] = withdrawAuthSecret;
      await this.saveActiveSession();
      ctx.write(`Position created: ${createdId.toString()} (withdraw secret stored locally).`, 'ok');
      return;
    }

    ctx.write('Supply tx confirmed, but could not auto-detect new position id. Run show-positions.', 'muted');
  }

  private async privateBalance(ctx: CommandContext) {
    await this.ensureTargetNetwork();
    await this.ensurePrivacyInitialized();
    const session = this.requireActiveSession();
    const { provider, signerAddress } = await ctx.getSigner();
    this.assertSessionEoa(session, signerAddress);
    const signer = await this.getBoundSigner(provider, signerAddress);
    const tokenAddress = this.getSupplyTokenAddress();

    const balance = await this.manager.getPrivateSpendableBalance({
      mnemonic: session.mnemonic,
      tokenAddress,
      publicWallet: signer,
    });
    this.debug(
      `private-balance: eoa=${signerAddress} private=${session.privateAddress} token=${tokenAddress} spendable=${formatTokenAmount(balance)}`,
    );
    ctx.write(`Private spendable balance: ${formatTokenAmount(balance)}`, 'ok');
  }

  private async showPositions(ctx: CommandContext) {
    await this.ensureTargetNetwork();
    const session = this.requireActiveSession();
    const { provider } = await ctx.getSigner();
    const adapterAddress = this.getAdapterAddress();
    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
    const zkOwnerHash = this.getZkOwnerHash(session.privateAddress);
    const result = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
    const ids = result[0] as BigNumber[];
    const total = result[1] as BigNumber;

    this.write(`Owner hash: ${zkOwnerHash}`);
    this.write(`Positions total: ${total.toString()}`);
    if (ids.length === 0) {
      this.write('No positions found for this private account.', 'muted');
      return;
    }

    for (const id of ids) {
      const position = await adapter.positions(id);
      const amount = position[3] as BigNumber;
      const token = position[2] as string;
      const vault = position[1] as string;
      const hasLocalSecret = Boolean(session.positionSecrets[id.toString()]);
      this.write(
        `- #${id.toString()} token=${token} vault=${vault} amount=${formatTokenAmount(amount)} secret=${hasLocalSecret ? 'yes' : 'no'}`,
      );
    }
  }

  private async privateWithdraw(
    ctx: CommandContext,
    positionIdText: string | undefined,
    amountText: string | undefined,
  ) {
    if (!positionIdText || !amountText) {
      throw new Error('Usage: private-withdraw <positionId> <amount|max>');
    }

    const session = this.requireActiveSession();
    await this.ensureTargetNetwork();
    await this.ensurePrivacyInitialized();

    const adapterAddress = this.getAdapterAddress();
    const emporiumAddress = this.getEmporiumAddress();
    const tokenAddress = this.getSupplyTokenAddress();
    const positionId = BigInt(positionIdText);
    const isMaxWithdraw = amountText.toLowerCase() === 'max';
    const currentSecret = session.positionSecrets[positionId.toString()];
    if (!currentSecret) {
      throw new Error(
        `No local withdraw secret found for position ${positionId.toString()}. Use show-positions and ensure this browser created the position.`,
      );
    }

    const { provider, signerAddress } = await ctx.getSigner();
    this.assertSessionEoa(session, signerAddress);
    const signer = await this.getBoundSigner(provider, signerAddress);
    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
    const positionBefore = await adapter.positions(positionId);
    const positionAmount = BigInt((positionBefore[3] as BigNumber).toString());
    if (positionAmount <= 0n) {
      throw new Error(`Position ${positionId.toString()} has no withdrawable amount.`);
    }

    let amount = isMaxWithdraw ? positionAmount : parseTokenAmount(amountText);
    if (!isMaxWithdraw && amount > positionAmount) {
      throw new Error(
        `Withdraw amount exceeds position balance. Requested ${amountText}, available ${formatTokenAmount(positionAmount)}.`,
      );
    }

    const nextSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
    const nextWithdrawAuthHash = ethers.utils.keccak256(nextSecret);
    const [privateSpendableBalance, privateActionContext] = await Promise.all([
      this.manager.getPrivateSpendableBalance({
        mnemonic: session.mnemonic,
        tokenAddress,
        publicWallet: signer,
      }),
      this.manager.getPrivateActionContext({
        mnemonic: session.mnemonic,
        publicWallet: signer,
      }),
    ]);
    const withdrawOps = this.buildPrivateWithdrawOps({
      adapterAddress,
      emporiumAddress,
      positionId,
      amount,
      withdrawAuthSecret: currentSecret,
      nextWithdrawAuthHash,
    });
    const estimatedFlatFee = await this.estimateEmporiumFlatFee({
      walletAddress: privateActionContext.subAccountAddress,
      feeTokenAddress: tokenAddress,
      erc20Addresses: [tokenAddress],
      ops: withdrawOps,
    });
    if (estimatedFlatFee != null) {
      const { reserve, usedBuffer, bpsBuffer, minBuffer } = this.getBufferedFeeReserve(estimatedFlatFee);
      ctx.write(
        `Fee estimate (withdraw): flatFee=${formatTokenAmount(estimatedFlatFee)} reserve=${formatTokenAmount(reserve)} requiredPrivateBalance=${formatTokenAmount(reserve)}`,
        'muted',
      );
      this.debug(
        `private-withdraw fee-estimate: flatFee=${formatTokenAmount(estimatedFlatFee)} buffer=${formatTokenAmount(usedBuffer)} reserve=${formatTokenAmount(reserve)} privateSpendable=${formatTokenAmount(privateSpendableBalance)} bufferBpsPart=${formatTokenAmount(bpsBuffer)} bufferMin=${formatTokenAmount(minBuffer)}`,
      );
      if (privateSpendableBalance < reserve) {
        throw new Error(
          `Insufficient private spendable balance for withdraw fee reserve. Need ${formatTokenAmount(reserve)}, available ${formatTokenAmount(privateSpendableBalance)}. Shield more USDC before withdrawing.`,
        );
      }
    }
    this.debug(
      `private-withdraw: eoa=${signerAddress} private=${session.privateAddress} token=${tokenAddress} positionId=${positionId.toString()} requested=${amountText} amount=${formatTokenAmount(amount)}`,
    );
    this.debug(
      `private-withdraw contracts: adapter=${adapterAddress} emporium=${emporiumAddress} positionAmount=${formatTokenAmount(positionAmount)}`,
    );
    this.write('Withdrawing from Aave position to private balance...', 'muted');

    let txHash: string;
    try {
      txHash = await ctx.manager.privateWithdraw({
        mnemonic: session.mnemonic,
        publicWallet: signer,
        adapterAddress,
        emporiumAddress,
        tokenAddress,
        positionId,
        amount,
        withdrawAuthSecret: currentSecret,
        nextWithdrawAuthHash,
      });
    } catch (error) {
      const errorText = String(error).toLowerCase();
      const isAaveMaxDustError =
        isMaxWithdraw &&
        amount > 1n &&
        (errorText.includes('47bc4b2c') || errorText.includes('notenoughavailableuserbalance'));
      if (!isAaveMaxDustError) {
        throw error;
      }

      amount -= 1n;
      this.debug(
        `private-withdraw max fallback: retrying with ${formatTokenAmount(amount)} due to Aave available-balance rounding`,
      );
      txHash = await ctx.manager.privateWithdraw({
        mnemonic: session.mnemonic,
        publicWallet: signer,
        adapterAddress,
        emporiumAddress,
        tokenAddress,
        positionId,
        amount,
        withdrawAuthSecret: currentSecret,
        nextWithdrawAuthHash,
      });
    }
    ctx.write(`Private withdraw tx: ${txHash}`, 'ok');

    const position = await adapter.positions(positionId);
    const remainingAmount = position[3] as BigNumber;
    if (remainingAmount.isZero()) {
      delete session.positionSecrets[positionId.toString()];
      await this.saveActiveSession();
      ctx.write(`Position ${positionId.toString()} closed. Local secret removed.`, 'ok');
      return;
    }

    session.positionSecrets[positionId.toString()] = nextSecret;
    await this.saveActiveSession();
    ctx.write(
      `Position ${positionId.toString()} updated. Remaining amount=${formatTokenAmount(remainingAmount)}. Secret rotated.`,
      'ok',
    );
  }
}

const terminalEl = document.getElementById('terminal');
const inputEl = document.getElementById('cli-input');

if (!(terminalEl instanceof HTMLElement) || !(inputEl instanceof HTMLInputElement)) {
  throw new Error('Terminal UI not found.');
}

new WebCLI(terminalEl, inputEl);
