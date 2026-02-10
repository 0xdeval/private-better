import { BrowserProvider, Contract, parseUnits } from 'ethers';
import { NETWORK_CONFIG } from '@railgun-community/shared-models';
import { RailgunManager } from '../railgun/railgunManager';
import { TEST_NETWORK, USDC_AMOY } from '../railgun/railgunConstants';

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

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
] as const;

const AMOY_CHAIN_ID_HEX = '0x13882';
const USDC_DECIMALS = 6;
const DEFAULT_TEST_MNEMONIC =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_RAILGUN_TEST_MNEMONIC;
const AMOY_CHAIN_PARAMS = {
  chainId: AMOY_CHAIN_ID_HEX,
  chainName: 'Polygon Amoy',
  nativeCurrency: {
    name: 'POL',
    symbol: 'POL',
    decimals: 18,
  },
  rpcUrls: ['https://rpc-amoy.polygon.technology'],
  blockExplorerUrls: ['https://amoy.polygonscan.com'],
};

class WebCLI {
  private terminalEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private history: string[] = [];
  private historyIndex = -1;
  private manager = new RailgunManager();

  constructor(terminalEl: HTMLElement, inputEl: HTMLInputElement) {
    this.terminalEl = terminalEl;
    this.inputEl = inputEl;

    this.write('Private Better Web CLI ready. Type `help`.', 'ok');
    this.write(`Network: ${TEST_NETWORK}`, 'muted');
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

  private async ensureAmoy() {
    const eth = this.getEthereumProvider();
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: AMOY_CHAIN_ID_HEX }],
      });
    } catch (error) {
      const rpcError = error as EthereumRpcError;
      if (rpcError.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [AMOY_CHAIN_PARAMS],
        });
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: AMOY_CHAIN_ID_HEX }],
        });
        return;
      }
      throw error;
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
        case 'set-rpc':
          this.setRpc(args[0]);
          return;
        case 'set-usdc':
          this.setUsdc(args[0]);
          return;
        case 'show-config':
          this.showConfig();
          return;
        case 'connect': {
          await this.ensureAmoy();
          const { signerAddress, providerLabel } = await ctx.getSigner();
          ctx.write(`Connected wallet (${providerLabel}): ${signerAddress}`, 'ok');
          return;
        }
        case 'init-railgun':
          await ctx.manager.initEngine();
          ctx.write('Railgun engine initialized.', 'ok');
          return;
        case 'generate-wallet': {
          const mnemonic = args.join(' ') || DEFAULT_TEST_MNEMONIC || '';
          if (!mnemonic) {
            ctx.write(
              'Usage: generate-wallet <mnemonic> (or set VITE_RAILGUN_TEST_MNEMONIC in .env)',
              'err',
            );
            return;
          }
          // In a real app, handle mnemonics securely!
          const addr = await ctx.manager.createWallet(mnemonic);
          ctx.write(`Railgun Wallet (0zk): ${addr}`, 'ok');
          return;
        }
        case 'approve-usdc':
          await this.approveUSDC(ctx, args[0]);
          return;
        case 'shield-usdc':
          await this.shieldUSDC(ctx, args[0], args[1]);
          return;
        case 'status':
          this.write('Commands ready: wallet connect, railgun init, approve, shield.', 'ok');
          return;
        case 'bet-mock':
          this.write('Placeholder: future Azuro bet command will plug in here.', 'muted');
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
    this.write('set-rpc <rpc-url>');
    this.write('set-usdc <usdc-address>');
    this.write('connect');
    this.write('init-railgun');
    this.write('approve-usdc <amount>   e.g. approve-usdc 1.5');
    this.write('shield-usdc <0zkAddress> <amount>   e.g. shield-usdc 0zk... 1.5');
    this.write('status');
    this.write('bet-mock');
  }

  private setRpc(rpc: string | undefined) {
    if (!rpc) throw new Error('Usage: set-rpc <rpc-url>');
    localStorage.setItem('pb.rpc', rpc);
    this.setAppConfig({ RAILGUN_RPC: rpc });
    this.write(`RPC updated: ${rpc}`, 'ok');
  }

  private setUsdc(token: string | undefined) {
    if (!token) throw new Error('Usage: set-usdc <usdc-address>');
    localStorage.setItem('pb.usdc', token);
    this.setAppConfig({ USDC_AMOY: token });
    this.write(`USDC updated: ${token}`, 'ok');
  }

  private setAppConfig(next: { RAILGUN_RPC?: string; USDC_AMOY?: string }) {
    const win = window as Window & {
      __APP_CONFIG__?: { RAILGUN_RPC?: string; USDC_AMOY?: string };
    };
    win.__APP_CONFIG__ = {
      ...win.__APP_CONFIG__,
      ...next,
    };
  }

  private showConfig() {
    const network = NETWORK_CONFIG[TEST_NETWORK];
    this.write(`network: ${TEST_NETWORK} (${network.chain.id})`);
    this.write(`rpc: ${this.getConfig().RAILGUN_RPC ?? '(unset)'}`);
    this.write(`usdc: ${USDC_AMOY}`);
    this.write(`railgunProxy: ${network.proxyContract}`);
  }

  private getConfig() {
    const win = window as Window & {
      __APP_CONFIG__?: { RAILGUN_RPC?: string; USDC_AMOY?: string };
    };
    return win.__APP_CONFIG__ ?? {};
  }

  private async approveUSDC(ctx: CommandContext, amountText: string | undefined) {
    if (!amountText) throw new Error('Usage: approve-usdc <amount>');
    await this.ensureAmoy();
    const { provider } = await ctx.getSigner();
    const signer = await provider.getSigner();

    const amount = parseUnits(amountText, USDC_DECIMALS);
    const proxy = NETWORK_CONFIG[TEST_NETWORK].proxyContract;

    const usdc = new Contract(USDC_AMOY, ERC20_ABI, signer) as any;
    const tx = await usdc.approve(proxy, amount);
    ctx.write(`Approve submitted: ${tx.hash}`);
    await tx.wait();
    ctx.write('Approve confirmed.', 'ok');
  }

  private async shieldUSDC(
    ctx: CommandContext,
    railgunAddress: string | undefined,
    amountText: string | undefined,
  ) {
    if (!railgunAddress || !amountText) {
      throw new Error('Usage: shield-usdc <0zkAddress> <amount>');
    }

    await this.ensureAmoy();
    const { provider } = await ctx.getSigner();
    const signer = await provider.getSigner();
    const amount = parseUnits(amountText, USDC_DECIMALS);

    const txHash = await ctx.manager.shieldUSDC(railgunAddress, signer as any, amount);
    ctx.write(`Shield confirmed: ${txHash}`, 'ok');
  }
}

const terminalEl = document.getElementById('terminal');
const inputEl = document.getElementById('cli-input');

if (!(terminalEl instanceof HTMLElement) || !(inputEl instanceof HTMLInputElement)) {
  throw new Error('Terminal UI not found.');
}

new WebCLI(terminalEl, inputEl);
