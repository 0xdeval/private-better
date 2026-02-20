import { Contract, ethers, Wallet } from 'ethers';

import { loadPrivacySession } from '../../privacy/privacySession';
import { ERC20_ABI } from '../abis';
import { formatTokenAmount, parseTokenAmount } from '../amounts';
import { WebCliRuntime } from '../runtime';

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const LOGIN_TEST_MNEMONIC_KEY = 'VITE_LOGIN_TEST_MNEMONIC';

const activateSessionFromMnemonic = async (
  runtime: WebCliRuntime,
  mnemonic: string,
  chainId: bigint,
  signerAddress: string,
  sessionKeyHex: string,
) => {
  const privateAddress = runtime.manager.derivePrivateAddress(mnemonic);
  runtime.setActiveSession({
    privateAddress,
    mnemonic,
    positionSecrets: {},
    sessionKeyHex,
    eoaAddress: signerAddress,
    chainId,
  });
  await runtime.saveActiveSession();
  return privateAddress;
};

export const loginCommand = async (runtime: WebCliRuntime) => {
  await runtime.ensureTargetNetwork();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.write('Please sign the session message in your wallet...', 'muted');
  const { chainId, sessionKeyHex } = await runtime.deriveSessionKey(provider, signerAddress);
  await runtime.ensurePrivacyInitialized();

  const stored = await loadPrivacySession(chainId, signerAddress, sessionKeyHex);
  if (stored) {
    runtime.setActiveSession({
      privateAddress: stored.privateAddress,
      mnemonic: stored.mnemonic,
      positionSecrets: stored.positionSecrets ?? {},
      sessionKeyHex,
      eoaAddress: signerAddress,
      chainId,
    });
    runtime.write(`Private account loaded: ${stored.privateAddress}`, 'ok');
    return;
  }

  const mnemonic = Wallet.createRandom().mnemonic?.phrase;
  if (!mnemonic) {
    throw new Error('Could not generate mnemonic.');
  }

  const privateAddress = await activateSessionFromMnemonic(
    runtime,
    mnemonic,
    chainId,
    signerAddress,
    sessionKeyHex,
  );
  runtime.write(`Private account created: ${privateAddress}`, 'ok');
  runtime.write(`Backup mnemonic now (sensitive): ${mnemonic}`, 'muted');
};

export const importCommand = async (runtime: WebCliRuntime, mnemonic: string) => {
  if (!mnemonic) {
    throw new Error('Usage: import <mnemonic>');
  }
  await runtime.ensureTargetNetwork();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.write('Please sign the session message in your wallet...', 'muted');
  const { chainId, sessionKeyHex } = await runtime.deriveSessionKey(provider, signerAddress);
  await runtime.ensurePrivacyInitialized();

  const privateAddress = await activateSessionFromMnemonic(
    runtime,
    mnemonic,
    chainId,
    signerAddress,
    sessionKeyHex,
  );
  runtime.write(`Private account imported: ${privateAddress}`, 'ok');
};

export const loginTestCommand = async (runtime: WebCliRuntime, mnemonicOverride: string | undefined) => {
  const rawMnemonic = mnemonicOverride?.trim() || env?.[LOGIN_TEST_MNEMONIC_KEY]?.trim();
  if (!rawMnemonic) {
    throw new Error(`Usage: login-test [mnemonic]. Or set ${LOGIN_TEST_MNEMONIC_KEY} in .env`);
  }

  await runtime.ensureTargetNetwork();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.write('Please sign the session message in your wallet...', 'muted');
  const { chainId, sessionKeyHex } = await runtime.deriveSessionKey(provider, signerAddress);
  await runtime.ensurePrivacyInitialized();

  const privateAddress = await activateSessionFromMnemonic(
    runtime,
    rawMnemonic,
    chainId,
    signerAddress,
    sessionKeyHex,
  );
  runtime.write(`Test private account loaded: ${privateAddress}`, 'ok');
};

export const approveCommand = async (runtime: WebCliRuntime, amountText: string | undefined) => {
  if (!amountText) throw new Error('Usage: approve <amount>');
  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);

  const supplyToken = runtime.getSupplyTokenConfig();
  const amount = ethers.utils.parseUnits(amountText, supplyToken.decimals);
  const spender = await runtime.manager.getShieldSpender({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });

  const erc20 = new Contract(supplyToken.address, ERC20_ABI, signer) as any;
  const tx = await erc20.approve(spender, amount);
  runtime.write(`Approve submitted: ${tx.hash}`);
  await tx.wait();
  runtime.write(`Approve confirmed for shield spender: ${spender}`, 'ok');
};

export const shieldCommand = async (runtime: WebCliRuntime, amountText: string | undefined) => {
  if (!amountText) {
    throw new Error('Usage: shield <amount>');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  const supplyToken = runtime.getSupplyTokenConfig();
  const amount = parseTokenAmount(amountText, supplyToken.decimals);

  const txHash = await runtime.manager.shieldToken({
    mnemonic: session.mnemonic,
    token: supplyToken,
    amount,
    publicWallet: signer,
  });

  runtime.write(`Shield confirmed: ${txHash}`, 'ok');
};

export const unshieldCommand = async (
  runtime: WebCliRuntime,
  amountText: string | undefined,
  recipientAddress: string | undefined,
) => {
  if (!amountText) {
    throw new Error('Usage: unshield <amount> [recipient]');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  const supplyToken = runtime.getSupplyTokenConfig();
  const amount = parseTokenAmount(amountText, supplyToken.decimals);
  const recipient = recipientAddress ?? signerAddress;

  const txHash = await runtime.manager.unshieldToken({
    mnemonic: session.mnemonic,
    token: supplyToken,
    amount,
    recipientAddress: recipient,
    publicWallet: signer,
  });
  runtime.write(`Unshield confirmed: ${txHash}`, 'ok');
};

export const unshieldWethCommand = async (
  runtime: WebCliRuntime,
  amountText: string | undefined,
  recipientAddress: string | undefined,
) => {
  if (!amountText) {
    throw new Error('Usage: unshield-weth <amount> [recipient]');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  const borrowToken = runtime.getBorrowWethTokenConfig();
  const amount = parseTokenAmount(amountText, borrowToken.decimals);
  const recipient = recipientAddress ?? signerAddress;

  const txHash = await runtime.manager.unshieldToken({
    mnemonic: session.mnemonic,
    token: borrowToken,
    amount,
    recipientAddress: recipient,
    publicWallet: signer,
  });
  runtime.write(`Unshield WETH confirmed: ${txHash}`, 'ok');
};

export const privateBalanceCommand = async (
  runtime: WebCliRuntime,
  tokenText: string | undefined,
) => {
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const session = runtime.requireActiveSession();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  const normalized = tokenText?.toLowerCase();
  if (normalized && normalized !== 'usdc' && normalized !== 'weth') {
    throw new Error('Usage: private-balance [usdc|weth]');
  }
  const token = normalized === 'weth' ? runtime.getBorrowWethTokenConfig() : runtime.getSupplyTokenConfig();

  const balance = await runtime.manager.getPrivateSpendableBalance({
    mnemonic: session.mnemonic,
    tokenAddress: token.address,
    publicWallet: signer,
  });
  runtime.write(
    `Private spendable ${token.symbol} balance: ${formatTokenAmount(balance, token.decimals)}`,
    'ok',
  );
};
