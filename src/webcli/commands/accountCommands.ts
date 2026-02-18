import { Contract, ethers, Wallet } from 'ethers';

import { loadPrivacySession } from '../../privacy/privacySession';
import { ERC20_ABI } from '../abis';
import { formatTokenAmount, parseTokenAmount } from '../amounts';
import { TOKEN_DECIMALS } from '../constants';
import { WebCliRuntime } from '../runtime';

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
  runtime.write(`Private account imported: ${privateAddress}`, 'ok');
};

export const approveCommand = async (runtime: WebCliRuntime, amountText: string | undefined) => {
  if (!amountText) throw new Error('Usage: approve <amount>');
  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);

  const amount = ethers.utils.parseUnits(amountText, TOKEN_DECIMALS);
  const token = runtime.getSupplyTokenAddress();
  const spender = await runtime.manager.getShieldSpender({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });

  const erc20 = new Contract(token, ERC20_ABI, signer) as any;
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
  const amount = parseTokenAmount(amountText);
  const tokenAddress = runtime.getSupplyTokenAddress();

  const txHash = await runtime.manager.shieldToken({
    mnemonic: session.mnemonic,
    tokenAddress,
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
  const amount = parseTokenAmount(amountText);
  const tokenAddress = runtime.getSupplyTokenAddress();
  const recipient = recipientAddress ?? signerAddress;

  const txHash = await runtime.manager.unshieldToken({
    mnemonic: session.mnemonic,
    tokenAddress,
    amount,
    recipientAddress: recipient,
    publicWallet: signer,
  });
  runtime.write(`Unshield confirmed: ${txHash}`, 'ok');
};

export const privateBalanceCommand = async (runtime: WebCliRuntime) => {
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();
  const session = runtime.requireActiveSession();
  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  const tokenAddress = runtime.getSupplyTokenAddress();

  const balance = await runtime.manager.getPrivateSpendableBalance({
    mnemonic: session.mnemonic,
    tokenAddress,
    publicWallet: signer,
  });
  runtime.write(`Private spendable balance: ${formatTokenAmount(balance)}`, 'ok');
};
