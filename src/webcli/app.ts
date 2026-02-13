import {
  BrowserProvider,
  Contract,
  Wallet,
  formatUnits,
  hexlify,
  keccak256,
  parseUnits,
  randomBytes,
  toUtf8Bytes,
} from 'ethers';
import { NETWORK_CONFIG } from '@railgun-community/shared-models';
import { RailgunManager } from '../railgun/railgunManager';
import {
  PRIVATE_SUPPLY_ADAPTER_ADDRESS,
  TEST_NETWORK,
  TEST_RPC_URL,
  TEST_USDC_ADDRESS,
} from '../railgun/railgunConstants';
import {
  clearRailgunSession,
  loadRailgunSession,
  saveRailgunSession,
  type RailgunLocalSession,
} from '../railgun/railgunSession';

type LineType = 'normal' | 'ok' | 'err' | 'muted';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
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
  manager: RailgunManager;
  getSigner: () => Promise<{
    provider: BrowserProvider;
    signerAddress: string;
    providerLabel: string;
  }>;
  write: (msg: string, type?: LineType) => void;
  clear: () => void;
};

type ActiveRailgunSession = {
  walletID: string;
  railgunAddress: string;
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
  'function positions(uint256) view returns (bytes32 zkOwnerHash, address vault, address token, uint256 amount, bytes32 withdrawAuthHash)',
  'function getOwnerPositionIds(bytes32 zkOwnerHash, uint256 offset, uint256 limit) view returns (uint256[] ids, uint256 total)',
] as const;

const MAX_UINT256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;
const TEST_CHAIN = NETWORK_CONFIG[TEST_NETWORK];
const TEST_CHAIN_ID_HEX = `0x${TEST_CHAIN.chain.id.toString(16)}`;
const TOKEN_DECIMALS = 6;
const DEFAULT_TEST_MNEMONIC =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_RAILGUN_TEST_MNEMONIC;
const TEST_CHAIN_PARAMS = {
  chainId: TEST_CHAIN_ID_HEX,
  chainName: TEST_CHAIN.publicName,
  nativeCurrency: {
    name: TEST_CHAIN.baseToken.symbol,
    symbol: TEST_CHAIN.baseToken.symbol,
    decimals: 18,
  },
  rpcUrls: [TEST_RPC_URL || 'https://arb1.arbitrum.io/rpc'],
  blockExplorerUrls: ['https://arbiscan.io'],
};

class WebCLI {
  private terminalEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private history: string[] = [];
  private historyIndex = -1;
  private manager = new RailgunManager();
  private railgunSession: ActiveRailgunSession | null = null;

  constructor(terminalEl: HTMLElement, inputEl: HTMLInputElement) {
    this.terminalEl = terminalEl;
    this.inputEl = inputEl;

    this.write('Private Better Web CLI ready. Type `help`.', 'ok');
    this.write(`Network: ${TEST_NETWORK}`, 'muted');
    this.write('Quick start:', 'muted');
    this.write('1) railgun-login -> login to Railgun wallet', 'muted');
    this.write('2) approve-usdc 1 -> approve USDC to Railgun contract', 'muted');
    this.write('3) shield-usdc 1 -> shield USDC to Railgun wallet', 'muted');
    this.write('4) private-supply 1 -> create private supply position on Aave', 'muted');
    this.write('5) private-withdraw <positionId> <amount|max> -> withdraw from private supply position on Aave', 'muted');
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
    provider: BrowserProvider;
    signerAddress: string;
    providerLabel: string;
  }> {
    const eth = this.getEthereumProvider();
    await eth.request({ method: 'eth_requestAccounts' });

    const provider = new BrowserProvider(eth as any);
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();
    return { provider, signerAddress, providerLabel: this.getProviderLabel(eth) };
  }

  private async ensureTestNetwork() {
    const eth = this.getEthereumProvider();
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TEST_CHAIN_ID_HEX }],
      });
    } catch (error) {
      const rpcError = error as EthereumRpcError;
      if (rpcError.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [TEST_CHAIN_PARAMS],
        });
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: TEST_CHAIN_ID_HEX }],
        });
        return;
      }
      throw error;
    }
  }

  private async ensureRailgunInitialized(): Promise<void> {
    const config = this.getConfig();
    const rpc = config.RAILGUN_RPC ?? TEST_RPC_URL;
    await this.manager.initEngine(rpc);
  }

  private async deriveSessionKey(
    provider: BrowserProvider,
    signerAddress: string,
  ): Promise<{ chainId: bigint; sessionKeyHex: string }> {
    const signer = await provider.getSigner();
    const network = await provider.getNetwork();
    const chainId = network.chainId;
    const message = `Private Better Railgun Session v1\nChain:${chainId.toString()}\nAddress:${signerAddress.toLowerCase()}`;
    const signature = await signer.signMessage(message);
    return { chainId, sessionKeyHex: keccak256(signature) };
  }

  private getZkOwnerHash(railgunAddress: string): string {
    return keccak256(toUtf8Bytes(railgunAddress));
  }

  private requireActiveSession(): ActiveRailgunSession {
    if (!this.railgunSession) {
      throw new Error('No active Railgun session. Run `railgun-login` first.');
    }
    return this.railgunSession;
  }

  private async saveActiveSession(): Promise<void> {
    const session = this.requireActiveSession();
    const payload: RailgunLocalSession = {
      walletID: session.walletID,
      railgunAddress: session.railgunAddress,
      mnemonic: session.mnemonic,
      positionSecrets: session.positionSecrets,
      updatedAt: Date.now(),
    };
    await saveRailgunSession(session.chainId, session.eoaAddress, session.sessionKeyHex, payload);
  }

  private getConfig() {
    const win = window as Window & {
      __APP_CONFIG__?: {
        RAILGUN_NETWORK?: string;
        RAILGUN_RPC?: string;
        SUPPLY_TOKEN?: string;
        PRIVATE_SUPPLY_ADAPTER?: string;
        USDC_ADDRESS?: string;
        USDC_SEPOLIA?: string;
        USDC_AMOY?: string;
      };
    };
    return win.__APP_CONFIG__ ?? {};
  }

  private getSupplyTokenAddress(): string {
    return this.getConfig().SUPPLY_TOKEN ?? TEST_USDC_ADDRESS;
  }

  private getAdapterAddress(): string {
    const configured = this.getConfig().PRIVATE_SUPPLY_ADAPTER;
    if (configured && configured !== '0xYOUR_PRIVATE_SUPPLY_ADAPTER') {
      return configured;
    }
    return PRIVATE_SUPPLY_ADAPTER_ADDRESS;
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
        case 'show-config':
          this.showConfig();
          return;
        case 'init-railgun':
          await this.ensureRailgunInitialized();
          ctx.write('Railgun engine initialized.', 'ok');
          return;
        case 'railgun-login':
          await this.railgunLogin(ctx);
          return;
        case 'railgun-import':
          await this.railgunImport(ctx, args.join(' '));
          return;
        case 'railgun-logout':
          this.railgunLogout(ctx);
          return;
        case 'railgun-forget':
          await this.railgunForget(ctx);
          return;
        case 'approve-usdc':
          await this.approveToken(ctx, args[0]);
          return;
        case 'shield-usdc':
          await this.shieldUSDC(ctx, args[0]);
          return;
        case 'private-supply':
          await this.privateSupply(ctx, args[0]);
          return;
        case 'show-positions':
          await this.showPositions(ctx);
          return;
        case 'private-withdraw':
          await this.privateWithdraw(ctx, args[0], args[1]);
          return;
        case 'railgun-wallet-status':
          await this.railgunWalletStatus(ctx);
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
    this.write('show-config');
    this.write('init-railgun');
    this.write('railgun-login');
    this.write('railgun-import <mnemonic>');
    this.write('railgun-logout');
    this.write('railgun-forget');
    this.write('approve-usdc <amount>   e.g. approve-usdc 1.5');
    this.write('shield-usdc <amount>   e.g. shield-usdc 1.5');
    this.write('private-supply <amount>   e.g. private-supply 1.0');
    this.write('show-positions');
    this.write('private-withdraw <positionId> <amount|max>   e.g. private-withdraw 1 max');
    this.write('railgun-wallet-status');
  }

  private showConfig() {
    const network = NETWORK_CONFIG[TEST_NETWORK];
    this.write(`network: ${TEST_NETWORK} (${network.chain.id})`);
    this.write(`rpc: ${this.getConfig().RAILGUN_RPC ?? TEST_RPC_URL ?? '(unset)'}`);
    this.write(`token: ${this.getSupplyTokenAddress()}`);
    this.write(`adapter: ${this.getAdapterAddress()}`);
    this.write(`railgunProxy: ${network.proxyContract}`);
    this.write(`railgunCallback(relayAdapt): ${network.relayAdaptContract}`);
  }

  private async railgunWalletStatus(ctx: CommandContext) {
    if (!this.railgunSession) {
      this.write('Railgun session: not logged in.', 'muted');
      return;
    }
    const session = this.railgunSession;
    const tokenAddress = this.getSupplyTokenAddress();
    let shieldedBalance = 'n/a';
    try {
      await this.ensureRailgunInitialized();
      const amount = await ctx.manager.getShieldedTokenBalance(session.walletID, tokenAddress);
      shieldedBalance = formatUnits(amount, TOKEN_DECIMALS);
    } catch (error) {
      this.write(`Could not refresh private balance: ${this.formatError(error)}`, 'muted');
    }

    this.write(`Railgun wallet ID: ${session.walletID}`, 'ok');
    this.write(`Railgun address: ${session.railgunAddress}`);
    this.write(`Shielded token balance (${tokenAddress}): ${shieldedBalance}`);
    this.write(
      `Tracked withdraw secrets: ${Object.keys(session.positionSecrets).length}`,
    );
  }

  private async railgunLogin(ctx: CommandContext) {
    await this.ensureTestNetwork();
    await this.ensureRailgunInitialized();
    const { provider, signerAddress } = await ctx.getSigner();
    const { chainId, sessionKeyHex } = await this.deriveSessionKey(provider, signerAddress);

    const stored = await loadRailgunSession(chainId, signerAddress, sessionKeyHex);
    if (stored) {
      const walletInfo = await ctx.manager.loadWallet(stored.walletID, sessionKeyHex);
      this.railgunSession = {
        walletID: walletInfo.id,
        railgunAddress: walletInfo.railgunAddress,
        mnemonic: stored.mnemonic,
        positionSecrets: stored.positionSecrets ?? {},
        sessionKeyHex,
        eoaAddress: signerAddress,
        chainId,
      };
      ctx.write(`Railgun wallet loaded: ${walletInfo.railgunAddress}`, 'ok');
      return;
    }

    const mnemonic = Wallet.createRandom().mnemonic?.phrase;
    if (!mnemonic) {
      throw new Error('Could not generate mnemonic.');
    }

    const walletInfo = await ctx.manager.createWallet(mnemonic, sessionKeyHex);
    this.railgunSession = {
      walletID: walletInfo.id,
      railgunAddress: walletInfo.railgunAddress,
      mnemonic,
      positionSecrets: {},
      sessionKeyHex,
      eoaAddress: signerAddress,
      chainId,
    };
    await this.saveActiveSession();
    ctx.write(`Railgun wallet created: ${walletInfo.railgunAddress}`, 'ok');
    ctx.write(`Backup mnemonic now (sensitive): ${mnemonic}`, 'muted');
  }

  private async railgunImport(ctx: CommandContext, mnemonic: string) {
    if (!mnemonic) {
      throw new Error('Usage: railgun-import <mnemonic>');
    }
    await this.ensureTestNetwork();
    await this.ensureRailgunInitialized();
    const { provider, signerAddress } = await ctx.getSigner();
    const { chainId, sessionKeyHex } = await this.deriveSessionKey(provider, signerAddress);

    const walletInfo = await ctx.manager.createWallet(mnemonic, sessionKeyHex);
    this.railgunSession = {
      walletID: walletInfo.id,
      railgunAddress: walletInfo.railgunAddress,
      mnemonic,
      positionSecrets: {},
      sessionKeyHex,
      eoaAddress: signerAddress,
      chainId,
    };
    await this.saveActiveSession();
    ctx.write(`Railgun wallet imported: ${walletInfo.railgunAddress}`, 'ok');
  }

  private railgunLogout(ctx: CommandContext) {
    this.railgunSession = null;
    ctx.write('Railgun session cleared from memory.', 'ok');
  }

  private async railgunForget(ctx: CommandContext) {
    if (!this.railgunSession) {
      await this.ensureTestNetwork();
      const { provider, signerAddress } = await ctx.getSigner();
      const { chainId } = await this.deriveSessionKey(provider, signerAddress);
      clearRailgunSession(chainId, signerAddress);
      ctx.write('Local Railgun session deleted for this wallet+chain.', 'ok');
      return;
    }
    clearRailgunSession(this.railgunSession.chainId, this.railgunSession.eoaAddress);
    this.railgunSession = null;
    ctx.write('Railgun session deleted from this browser (forget complete).', 'ok');
  }

  private async approveToken(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) throw new Error('Usage: approve-usdc <amount>');
    await this.ensureTestNetwork();
    const { provider } = await ctx.getSigner();
    const signer = await provider.getSigner();

    const amount = parseUnits(amountText, TOKEN_DECIMALS);
    const proxy = NETWORK_CONFIG[TEST_NETWORK].proxyContract;
    const token = this.getSupplyTokenAddress();

    const erc20 = new Contract(token, ERC20_ABI, signer) as any;
    const tx = await erc20.approve(proxy, amount);
    ctx.write(`Approve submitted: ${tx.hash}`);
    await tx.wait();
    ctx.write('Approve confirmed.', 'ok');
  }

  private async shieldUSDC(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) {
      throw new Error('Usage: shield-usdc <amount>');
    }

    const session = this.requireActiveSession();
    await this.ensureTestNetwork();
    await this.ensureRailgunInitialized();
    const { provider } = await ctx.getSigner();
    const signer = await provider.getSigner();
    const amount = parseUnits(amountText, TOKEN_DECIMALS);
    const tokenAddress = this.getSupplyTokenAddress();

    const txHash = await ctx.manager.shieldUSDC(
      session.railgunAddress,
      signer,
      amount,
      tokenAddress,
    );
    ctx.write(`Shield confirmed: ${txHash}`, 'ok');
  }

  private async privateSupply(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) throw new Error('Usage: private-supply <amount>');
    await this.ensureTestNetwork();
    await this.ensureRailgunInitialized();

    const session = this.requireActiveSession();
    const amount = parseUnits(amountText, TOKEN_DECIMALS);
    const adapterAddress = this.getAdapterAddress();
    const tokenAddress = this.getSupplyTokenAddress();
    if (adapterAddress === '0xYOUR_PRIVATE_SUPPLY_ADAPTER') {
      throw new Error('Missing adapter address. Set VITE_PRIVATE_SUPPLY_ADAPTER in .env.');
    }

    const { provider } = await ctx.getSigner();
    const signer = await provider.getSigner();
    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
    const zkOwnerHash = this.getZkOwnerHash(session.railgunAddress);
    const beforeIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0n, 500n);
    const beforeIds = (beforeIdsRaw[0] as bigint[]).map((id) => id.toString());
    const beforeSet = new Set(beforeIds);

    const withdrawAuthSecret = hexlify(randomBytes(32));
    const withdrawAuthHash = keccak256(withdrawAuthSecret);

    const txHash = await ctx.manager.privateSupply({
      walletID: session.walletID,
      encryptionKey: session.sessionKeyHex,
      publicWallet: signer,
      adapterAddress,
      tokenAddress,
      amount,
      zkOwnerHash,
      withdrawAuthHash,
    });
    ctx.write(`Private supply tx: ${txHash}`, 'ok');

    const afterIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0n, 500n);
    const afterIds = afterIdsRaw[0] as bigint[];
    const createdId = afterIds.find((id) => !beforeSet.has(id.toString())) ?? afterIds.at(-1);
    if (createdId != null) {
      session.positionSecrets[createdId.toString()] = withdrawAuthSecret;
      await this.saveActiveSession();
      ctx.write(`Position created: ${createdId.toString()} (withdraw secret stored locally).`, 'ok');
      return;
    }

    ctx.write('Supply tx confirmed, but could not auto-detect new position id. Run show-positions.', 'muted');
  }

  private async showPositions(ctx: CommandContext) {
    await this.ensureTestNetwork();
    const session = this.requireActiveSession();
    const { provider } = await ctx.getSigner();
    const adapterAddress = this.getAdapterAddress();
    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
    const zkOwnerHash = this.getZkOwnerHash(session.railgunAddress);
    const result = await adapter.getOwnerPositionIds(zkOwnerHash, 0n, 500n);
    const ids = result[0] as bigint[];
    const total = result[1] as bigint;

    this.write(`Owner hash: ${zkOwnerHash}`);
    this.write(`Positions total: ${total.toString()}`);
    if (ids.length === 0) {
      this.write('No positions found for this Railgun wallet.', 'muted');
      return;
    }

    for (const id of ids) {
      const position = await adapter.positions(id);
      const amount = position[3] as bigint;
      const token = position[2] as string;
      const vault = position[1] as string;
      const hasLocalSecret = Boolean(session.positionSecrets[id.toString()]);
      this.write(
        `- #${id.toString()} token=${token} vault=${vault} amount=${formatUnits(amount, TOKEN_DECIMALS)} secret=${hasLocalSecret ? 'yes' : 'no'}`,
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
    await this.ensureTestNetwork();
    await this.ensureRailgunInitialized();

    const adapterAddress = this.getAdapterAddress();
    const positionId = BigInt(positionIdText);
    const amount =
      amountText.toLowerCase() === 'max' ? MAX_UINT256 : parseUnits(amountText, TOKEN_DECIMALS);
    const currentSecret = session.positionSecrets[positionId.toString()];
    if (!currentSecret) {
      throw new Error(
        `No local withdraw secret found for position ${positionId.toString()}. Use show-positions and ensure this browser created the position.`,
      );
    }

    const nextSecret = amount === MAX_UINT256 ? null : hexlify(randomBytes(32));
    const nextWithdrawAuthHash =
      nextSecret == null
        ? '0x0000000000000000000000000000000000000000000000000000000000000000'
        : keccak256(nextSecret);

    const { provider } = await ctx.getSigner();
    const signer = await provider.getSigner();
    const txHash = await ctx.manager.privateWithdraw({
      walletID: session.walletID,
      encryptionKey: session.sessionKeyHex,
      publicWallet: signer,
      adapterAddress,
      positionId,
      amount,
      withdrawAuthSecret: currentSecret,
      nextWithdrawAuthHash,
    });
    ctx.write(`Private withdraw tx: ${txHash}`, 'ok');

    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
    const position = await adapter.positions(positionId);
    const remainingAmount = position[3] as bigint;
    if (remainingAmount === 0n) {
      delete session.positionSecrets[positionId.toString()];
      await this.saveActiveSession();
      ctx.write(`Position ${positionId.toString()} closed. Local secret removed.`, 'ok');
      return;
    }

    if (nextSecret == null) {
      delete session.positionSecrets[positionId.toString()];
    } else {
      session.positionSecrets[positionId.toString()] = nextSecret;
    }
    await this.saveActiveSession();
    ctx.write(
      `Position ${positionId.toString()} updated. Remaining amount=${formatUnits(remainingAmount, TOKEN_DECIMALS)}. Secret rotated.`,
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
