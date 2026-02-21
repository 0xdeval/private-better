import { BigNumber, Contract, ethers, type Signer } from 'ethers';

import { ADAPTER_ABI, ERC20_ABI } from '../abis';
import { formatTokenAmount, parseTokenAmount } from '../amounts';
import { WebCliRuntime } from '../runtime';

const isBytes32Hex = (value: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(value);

const parsePositionAuthSecret = (value: string, label = 'auth secret'): string => {
  if (!isBytes32Hex(value)) {
    throw new Error(`Invalid ${label}. Expected 32-byte hex like 0xabc... (64 hex chars).`);
  }
  return ethers.utils.hexlify(value).toLowerCase();
};

const resolvePositionAuthSecret = (
  positionSecrets: Record<string, string>,
  positionId: bigint,
  providedSecret: string | undefined,
): { secret: string; usedProvided: boolean } => {
  if (providedSecret != null) {
    return {
      secret: parsePositionAuthSecret(providedSecret, 'withdraw auth secret'),
      usedProvided: true,
    };
  }

  const stored = positionSecrets[positionId.toString()];
  if (!stored) {
    throw new Error(
      `No local auth secret found for position ${positionId.toString()}. Use position-auth <positionId> <withdrawAuth> with your saved secret.`,
    );
  }
  return { secret: stored, usedProvided: false };
};

type BalanceToken = {
  address: string;
  symbol: string;
  decimals: number;
};

type BalanceRetryOptions = {
  maxRefreshAttempts?: number;
  retryDelayMs?: number;
};

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const resolveRequiredPrivateBalance = async (params: {
  runtime: WebCliRuntime;
  mnemonic: string;
  publicWallet: Signer;
  token: BalanceToken;
  required: bigint;
  label: string;
  options?: BalanceRetryOptions;
}): Promise<bigint> => {
  const maxRefreshAttempts = params.options?.maxRefreshAttempts ?? 3;
  const retryDelayMs = params.options?.retryDelayMs ?? 1500;

  let balance = await params.runtime.manager.getPrivateSpendableBalance({
    mnemonic: params.mnemonic,
    tokenAddress: params.token.address,
    publicWallet: params.publicWallet,
    forceRefresh: false,
  });

  if (balance >= params.required || maxRefreshAttempts <= 0) {
    return balance;
  }

  params.runtime.write(`Balance sync (${params.label}): cached balance below required, refreshing...`, 'muted');

  for (let attempt = 0; attempt < maxRefreshAttempts; attempt += 1) {
    balance = await params.runtime.manager.getPrivateSpendableBalance({
      mnemonic: params.mnemonic,
      tokenAddress: params.token.address,
      publicWallet: params.publicWallet,
      forceRefresh: true,
    });
    if (balance >= params.required) {
      return balance;
    }
    if (attempt < maxRefreshAttempts - 1) {
      await wait(retryDelayMs);
    }
  }

  return balance;
};

export const privateSupplyCommand = async (
  runtime: WebCliRuntime,
  amountText: string | undefined,
) => {
  if (!amountText) throw new Error('Usage: private-supply <amount>');
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();

  const session = runtime.requireActiveSession();
  const supplyToken = runtime.getSupplyTokenConfig();
  const amount = parseTokenAmount(amountText, supplyToken.decimals);
  const adapterAddress = runtime.getAdapterAddress();
  const emporiumAddress = runtime.getEmporiumAddress();

  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  await runtime.validatePrivateSupplyConfig(provider, adapterAddress, supplyToken.address, emporiumAddress);

  runtime.write('Building private supply transaction...', 'muted');
  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
  const erc20 = new Contract(supplyToken.address, ERC20_ABI, provider) as any;
  const spender = await runtime.manager.getShieldSpender({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });
  const [publicBalance, allowanceToSpender] = await Promise.all([
    erc20.balanceOf(signerAddress),
    erc20.allowance(signerAddress, spender),
  ]);
  runtime.debug(
    `private-supply preflight: publicBalance=${formatTokenAmount(publicBalance, supplyToken.decimals)} allowanceToHinkal=${formatTokenAmount(allowanceToSpender, supplyToken.decimals)}`,
  );

  let privateSpendableBalance = await resolveRequiredPrivateBalance({
    runtime,
    mnemonic: session.mnemonic,
    publicWallet: signer,
    token: supplyToken,
    required: amount,
    label: 'supply-amount',
  });
  const privateActionContext = await runtime.manager.getPrivateActionContext({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });
  const zkOwnerHash = runtime.getZkOwnerHash(session.privateAddress);

  if (privateSpendableBalance < amount) {
    throw new Error(
      `Insufficient private spendable balance. Need ${amountText}, available ${formatTokenAmount(privateSpendableBalance, supplyToken.decimals)}.`,
    );
  }

  const withdrawAuthSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const withdrawAuthHash = ethers.utils.keccak256(withdrawAuthSecret);
  const supplyOps = runtime.buildPrivateSupplyOps({
    adapterAddress,
    tokenAddress: supplyToken.address,
    amount,
    zkOwnerHash,
    withdrawAuthHash,
  });
  const estimatedFlatFee = await runtime.estimateEmporiumFlatFee({
    walletAddress: privateActionContext.subAccountAddress,
    feeTokenAddress: supplyToken.address,
    erc20Addresses: [supplyToken.address],
    ops: supplyOps,
  });

  if (estimatedFlatFee != null) {
    const { reserve } = runtime.getBufferedFeeReserve(estimatedFlatFee);
    const requiredTotal = amount + reserve;
    runtime.write(
      `Fee estimate (supply): flatFee=${formatTokenAmount(estimatedFlatFee, supplyToken.decimals)} reserve=${formatTokenAmount(reserve, supplyToken.decimals)} required=${formatTokenAmount(requiredTotal, supplyToken.decimals)}`,
      'muted',
    );
    runtime.debugFeeEstimate('supply-fee', estimatedFlatFee, reserve, requiredTotal);
    privateSpendableBalance = await resolveRequiredPrivateBalance({
      runtime,
      mnemonic: session.mnemonic,
      publicWallet: signer,
      token: supplyToken,
      required: requiredTotal,
      label: 'supply-fee-reserve',
    });
    if (privateSpendableBalance < requiredTotal) {
      throw new Error(
        `Insufficient private spendable balance for supply + fee reserve. Need ${formatTokenAmount(requiredTotal, supplyToken.decimals)}, available ${formatTokenAmount(privateSpendableBalance, supplyToken.decimals)}.`,
      );
    }
  }

  const beforeIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
  const beforeIds = (beforeIdsRaw[0] as BigNumber[]).map((id) => id.toString());
  const beforeSet = new Set(beforeIds);

  let txHash: string;
  try {
    txHash = await runtime.manager.privateSupply({
      mnemonic: session.mnemonic,
      publicWallet: signer,
      adapterAddress,
      token: supplyToken,
      amount,
      zkOwnerHash,
      withdrawAuthHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('insufficient funds')) {
      throw new Error(
        `Insufficient private funds for supply + Hinkal fee. Current private spendable=${formatTokenAmount(privateSpendableBalance, supplyToken.decimals)}. Try a smaller amount or shield more USDC first.`,
      );
    }
    throw error;
  }
  runtime.write(`Private supply tx: ${txHash}`, 'ok');

  const afterIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
  const afterIds = afterIdsRaw[0] as BigNumber[];
  const createdId = afterIds.find((id) => !beforeSet.has(id.toString())) ?? afterIds.at(-1);
  if (createdId != null) {
    const positionId = createdId.toString();
    session.positionSecrets[positionId] = withdrawAuthSecret;
    await runtime.saveActiveSession();
    runtime.write(`Position created: ${positionId} (withdraw secret stored locally).`, 'ok');
    runtime.write(
      `WithdrawAuth backup (SAVE SECURELY): positionId=${positionId} secret=${withdrawAuthSecret}`,
      'ok',
    );
    return;
  }

  runtime.write('Supply tx confirmed, but could not auto-detect new position id. Run supply-positions.', 'muted');
  runtime.write(
    `WithdrawAuth backup (SAVE SECURELY): secret=${withdrawAuthSecret}. After finding the position id, bind it with: position-auth <positionId> <withdrawAuth>.`,
    'muted',
  );
};

export const supplyPositionsCommand = async (runtime: WebCliRuntime) => {
  await runtime.ensureTargetNetwork();
  const session = runtime.requireActiveSession();
  const supplyToken = runtime.getSupplyTokenConfig();
  const { provider } = await runtime.getSigner();
  const adapterAddress = runtime.getAdapterAddress();
  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
  const zkOwnerHash = runtime.getZkOwnerHash(session.privateAddress);
  const result = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
  const ids = result[0] as BigNumber[];
  const total = result[1] as BigNumber;

  runtime.write(`Owner hash: ${zkOwnerHash}`);
  runtime.write(`Positions total: ${total.toString()}`);
  if (ids.length === 0) {
    runtime.write('No positions found for this private account.', 'muted');
    return;
  }

  for (const id of ids) {
    const position = await adapter.positions(id);
    const amount = position[3] as BigNumber;
    const token = position[2] as string;
    const vault = position[1] as string;
    const hasLocalSecret = Boolean(session.positionSecrets[id.toString()]);
    runtime.write(
      `- #${id.toString()} token=${token} vault=${vault} collateral=${formatTokenAmount(amount, supplyToken.decimals)} secret=${hasLocalSecret ? 'yes' : 'no'}`,
    );
  }
};

export const privateWithdrawCommand = async (
  runtime: WebCliRuntime,
  positionIdText: string | undefined,
  amountText: string | undefined,
  providedSecretText?: string,
) => {
  if (!positionIdText || !amountText) {
    throw new Error('Usage: private-withdraw <positionId> <amount|max> [withdrawAuth]');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();

  const adapterAddress = runtime.getAdapterAddress();
  const emporiumAddress = runtime.getEmporiumAddress();
  const supplyToken = runtime.getSupplyTokenConfig();
  const positionId = BigInt(positionIdText);
  const isMaxWithdraw = amountText.toLowerCase() === 'max';
  const { secret: currentSecret, usedProvided } = resolvePositionAuthSecret(
    session.positionSecrets,
    positionId,
    providedSecretText?.trim(),
  );
  if (usedProvided) {
    runtime.write('Using WithdrawAuth provided in command input.', 'muted');
  }

  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
  const positionBefore = await adapter.positions(positionId);
  const positionAmount = BigInt((positionBefore[3] as BigNumber).toString());
  if (positionAmount <= 0n) {
    throw new Error(`Position ${positionId.toString()} has no withdrawable amount.`);
  }

  let amount = isMaxWithdraw ? positionAmount : parseTokenAmount(amountText, supplyToken.decimals);
  if (!isMaxWithdraw && amount > positionAmount) {
    throw new Error(
      `Withdraw amount exceeds position balance. Requested ${amountText}, available ${formatTokenAmount(positionAmount, supplyToken.decimals)}.`,
    );
  }

  const nextSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const nextWithdrawAuthHash = ethers.utils.keccak256(nextSecret);
  const privateActionContext = await runtime.manager.getPrivateActionContext({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });
  const withdrawOps = runtime.buildPrivateWithdrawOps({
    adapterAddress,
    emporiumAddress,
    positionId,
    amount,
    withdrawAuthSecret: currentSecret,
    nextWithdrawAuthHash,
  });
  const estimatedFlatFee = await runtime.estimateEmporiumFlatFee({
    walletAddress: privateActionContext.subAccountAddress,
    feeTokenAddress: supplyToken.address,
    erc20Addresses: [supplyToken.address],
    ops: withdrawOps,
  });
  if (estimatedFlatFee != null) {
    const { reserve } = runtime.getBufferedFeeReserve(estimatedFlatFee);
    const privateSpendableBalance = await resolveRequiredPrivateBalance({
      runtime,
      mnemonic: session.mnemonic,
      publicWallet: signer,
      token: supplyToken,
      required: reserve,
      label: 'withdraw-fee-reserve',
    });
    runtime.write(
      `Fee estimate (withdraw): flatFee=${formatTokenAmount(estimatedFlatFee, supplyToken.decimals)} reserve=${formatTokenAmount(reserve, supplyToken.decimals)} requiredPrivateBalance=${formatTokenAmount(reserve, supplyToken.decimals)}`,
      'muted',
    );
    runtime.debugFeeEstimate('withdraw-fee', estimatedFlatFee, reserve, reserve);
    if (privateSpendableBalance < reserve) {
      throw new Error(
        `Insufficient private spendable balance for withdraw fee reserve. Need ${formatTokenAmount(reserve, supplyToken.decimals)}, available ${formatTokenAmount(privateSpendableBalance, supplyToken.decimals)}. Shield more USDC before withdrawing.`,
      );
    }
  }
  runtime.write('Withdrawing from Aave position to private balance...', 'muted');

  let txHash: string;
  try {
    txHash = await runtime.manager.privateWithdraw({
      mnemonic: session.mnemonic,
      publicWallet: signer,
      adapterAddress,
      emporiumAddress,
      token: supplyToken,
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
      (
        errorText.includes('47bc4b2c') ||
        errorText.includes('notenoughavailableuserbalance') ||
        errorText.includes('balance diff should be equal to sum of onchain and offchain created commitments')
      );
    if (!isAaveMaxDustError) {
      throw error;
    }

    amount -= 1n;
    runtime.debug(
      `private-withdraw max fallback: retrying with ${formatTokenAmount(amount, supplyToken.decimals)} due to Aave available-balance rounding`,
    );
    txHash = await runtime.manager.privateWithdraw({
      mnemonic: session.mnemonic,
      publicWallet: signer,
      adapterAddress,
      emporiumAddress,
      token: supplyToken,
      positionId,
      amount,
      withdrawAuthSecret: currentSecret,
      nextWithdrawAuthHash,
    });
  }
  runtime.write(`Private withdraw tx: ${txHash}`, 'ok');

  const position = await adapter.positions(positionId);
  const remainingAmount = position[3] as BigNumber;
  if (remainingAmount.isZero()) {
    delete session.positionSecrets[positionId.toString()];
    await runtime.saveActiveSession();
    runtime.write(`Position ${positionId.toString()} closed. Local secret removed.`, 'ok');
    return;
  }

  session.positionSecrets[positionId.toString()] = nextSecret;
  await runtime.saveActiveSession();
  runtime.write(
    `Position ${positionId.toString()} updated. Remaining amount=${formatTokenAmount(remainingAmount, supplyToken.decimals)}. Secret rotated.`,
    'ok',
  );
  runtime.write(
    `WithdrawAuth backup (SAVE SECURELY): positionId=${positionId.toString()} secret=${nextSecret}`,
    'ok',
  );
};

export const privateBorrowCommand = async (
  runtime: WebCliRuntime,
  positionIdText: string | undefined,
  amountText: string | undefined,
  providedSecretText?: string,
) => {
  if (!positionIdText || !amountText) {
    throw new Error('Usage: private-borrow <positionId> <amount> [withdrawAuth]');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();

  const adapterAddress = runtime.getAdapterAddress();
  const emporiumAddress = runtime.getEmporiumAddress();
  const supplyToken = runtime.getSupplyTokenConfig();
  const borrowToken = runtime.getBorrowWethTokenConfig();
  const positionId = BigInt(positionIdText);
  const amount = parseTokenAmount(amountText, borrowToken.decimals);
  const { secret: currentSecret, usedProvided } = resolvePositionAuthSecret(
    session.positionSecrets,
    positionId,
    providedSecretText?.trim(),
  );
  if (usedProvided) {
    runtime.write('Using WithdrawAuth provided in command input.', 'muted');
  }

  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  await runtime.validatePrivateBorrowConfig(
    provider,
    adapterAddress,
    supplyToken.address,
    borrowToken.address,
    emporiumAddress,
  );

  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
  const positionBefore = await adapter.positions(positionId);
  const collateralAmount = BigInt((positionBefore[3] as BigNumber).toString());
  if (collateralAmount <= 0n) {
    throw new Error(`Position ${positionId.toString()} has no collateral and cannot borrow.`);
  }

  const nextSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const nextAuthHash = ethers.utils.keccak256(nextSecret);
  const privateActionContext = await runtime.manager.getPrivateActionContext({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });

  const borrowOps = runtime.buildPrivateBorrowOps({
    adapterAddress,
    emporiumAddress,
    debtTokenAddress: borrowToken.address,
    positionId,
    amount,
    authSecret: currentSecret,
    nextAuthHash,
  });
  const estimatedFlatFee = await runtime.estimateEmporiumFlatFee({
    walletAddress: privateActionContext.subAccountAddress,
    feeTokenAddress: supplyToken.address,
    erc20Addresses: [supplyToken.address, borrowToken.address],
    ops: borrowOps,
  });
  if (estimatedFlatFee != null) {
    const { reserve } = runtime.getBufferedFeeReserve(estimatedFlatFee);
    const privateUsdcBalance = await resolveRequiredPrivateBalance({
      runtime,
      mnemonic: session.mnemonic,
      publicWallet: signer,
      token: supplyToken,
      required: reserve,
      label: 'borrow-fee-reserve',
    });
    runtime.write(
      `Fee estimate (borrow): flatFee=${formatTokenAmount(estimatedFlatFee, supplyToken.decimals)} reserve=${formatTokenAmount(reserve, supplyToken.decimals)} requiredPrivateUSDC=${formatTokenAmount(reserve, supplyToken.decimals)}`,
      'muted',
    );
    runtime.debugFeeEstimate('borrow-fee', estimatedFlatFee, reserve, reserve);
    if (privateUsdcBalance < reserve) {
      throw new Error(
        `Insufficient private USDC for borrow fee reserve. Need ${formatTokenAmount(reserve, supplyToken.decimals)}, available ${formatTokenAmount(privateUsdcBalance, supplyToken.decimals)}.`,
      );
    }
  }

  runtime.write('Borrowing WETH to private balance...', 'muted');
  const txHash = await runtime.manager.privateBorrow({
    mnemonic: session.mnemonic,
    publicWallet: signer,
    adapterAddress,
    emporiumAddress,
    borrowToken,
    feeToken: supplyToken,
    positionId,
    amount,
    authSecret: currentSecret,
    nextAuthHash,
  });
  runtime.write(`Private borrow tx: ${txHash}`, 'ok');

  session.positionSecrets[positionId.toString()] = nextSecret;
  await runtime.saveActiveSession();
  runtime.write(
    `Position ${positionId.toString()} borrowed ${formatTokenAmount(amount, borrowToken.decimals)} ${borrowToken.symbol}. Secret rotated.`,
    'ok',
  );
  runtime.write(
    `WithdrawAuth backup (SAVE SECURELY): positionId=${positionId.toString()} secret=${nextSecret}`,
    'ok',
  );
};

export const privateRepayCommand = async (
  runtime: WebCliRuntime,
  positionIdText: string | undefined,
  amountText: string | undefined,
  providedSecretText?: string,
) => {
  if (!positionIdText || !amountText) {
    throw new Error('Usage: private-repay <positionId> <amount> [withdrawAuth]');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();

  const adapterAddress = runtime.getAdapterAddress();
  const emporiumAddress = runtime.getEmporiumAddress();
  const supplyToken = runtime.getSupplyTokenConfig();
  const borrowToken = runtime.getBorrowWethTokenConfig();
  const positionId = BigInt(positionIdText);
  const amount = parseTokenAmount(amountText, borrowToken.decimals);
  const { secret: currentSecret, usedProvided } = resolvePositionAuthSecret(
    session.positionSecrets,
    positionId,
    providedSecretText?.trim(),
  );
  if (usedProvided) {
    runtime.write('Using WithdrawAuth provided in command input.', 'muted');
  }

  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  await runtime.validatePrivateBorrowConfig(
    provider,
    adapterAddress,
    supplyToken.address,
    borrowToken.address,
    emporiumAddress,
  );

  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
  const positionBefore = await adapter.positions(positionId);
  const collateralAmount = BigInt((positionBefore[3] as BigNumber).toString());
  if (collateralAmount <= 0n) {
    throw new Error(`Position ${positionId.toString()} is empty.`);
  }

  const nextSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const nextAuthHash = ethers.utils.keccak256(nextSecret);
  const privateActionContext = await runtime.manager.getPrivateActionContext({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });
  const privateWethBalance = await resolveRequiredPrivateBalance({
    runtime,
    mnemonic: session.mnemonic,
    publicWallet: signer,
    token: borrowToken,
    required: amount,
    label: 'repay-amount',
  });

  if (privateWethBalance < amount) {
    throw new Error(
      `Insufficient private ${borrowToken.symbol} for repay. Need ${formatTokenAmount(amount, borrowToken.decimals)}, available ${formatTokenAmount(privateWethBalance, borrowToken.decimals)}.`,
    );
  }

  const repayOps = runtime.buildPrivateRepayOps({
    adapterAddress,
    debtTokenAddress: borrowToken.address,
    positionId,
    amount,
    authSecret: currentSecret,
    nextAuthHash,
  });
  const estimatedFlatFee = await runtime.estimateEmporiumFlatFee({
    walletAddress: privateActionContext.subAccountAddress,
    feeTokenAddress: supplyToken.address,
    erc20Addresses: [supplyToken.address, borrowToken.address],
    ops: repayOps,
  });
  if (estimatedFlatFee != null) {
    const { reserve } = runtime.getBufferedFeeReserve(estimatedFlatFee);
    const privateUsdcBalance = await resolveRequiredPrivateBalance({
      runtime,
      mnemonic: session.mnemonic,
      publicWallet: signer,
      token: supplyToken,
      required: reserve,
      label: 'repay-fee-reserve',
    });
    runtime.write(
      `Fee estimate (repay): flatFee=${formatTokenAmount(estimatedFlatFee, supplyToken.decimals)} reserve=${formatTokenAmount(reserve, supplyToken.decimals)} requiredPrivateUSDC=${formatTokenAmount(reserve, supplyToken.decimals)}`,
      'muted',
    );
    runtime.debugFeeEstimate('repay-fee', estimatedFlatFee, reserve, reserve);
    if (privateUsdcBalance < reserve) {
      throw new Error(
        `Insufficient private USDC for repay fee reserve. Need ${formatTokenAmount(reserve, supplyToken.decimals)}, available ${formatTokenAmount(privateUsdcBalance, supplyToken.decimals)}.`,
      );
    }
  }

  runtime.write('Repaying WETH debt from private balance...', 'muted');
  const txHash = await runtime.manager.privateRepay({
    mnemonic: session.mnemonic,
    publicWallet: signer,
    adapterAddress,
    debtToken: borrowToken,
    feeToken: supplyToken,
    positionId,
    amount,
    authSecret: currentSecret,
    nextAuthHash,
  });
  runtime.write(`Private repay tx: ${txHash}`, 'ok');

  session.positionSecrets[positionId.toString()] = nextSecret;
  await runtime.saveActiveSession();
  runtime.write(
    `Position ${positionId.toString()} repaid ${formatTokenAmount(amount, borrowToken.decimals)} ${borrowToken.symbol}. Secret rotated.`,
    'ok',
  );
  runtime.write(
    `WithdrawAuth backup (SAVE SECURELY): positionId=${positionId.toString()} secret=${nextSecret}`,
    'ok',
  );
};

export const positionAuthCommand = async (
  runtime: WebCliRuntime,
  positionIdText: string | undefined,
  authSecretText: string | undefined,
) => {
  if (!positionIdText) {
    throw new Error('Usage: position-auth <positionId> [withdrawAuth]');
  }

  const session = runtime.requireActiveSession();
  const positionId = BigInt(positionIdText).toString();

  if (!authSecretText) {
    const existing = session.positionSecrets[positionId];
    if (!existing) {
      runtime.write(`No local WithdrawAuth stored for position ${positionId}.`, 'muted');
      return;
    }
    runtime.write(
      `WithdrawAuth backup (SAVE SECURELY): positionId=${positionId} secret=${existing}`,
      'ok',
    );
    return;
  }

  const parsed = parsePositionAuthSecret(authSecretText.trim(), 'withdraw auth secret');
  session.positionSecrets[positionId] = parsed;
  await runtime.saveActiveSession();
  runtime.write(`Stored WithdrawAuth for position ${positionId}.`, 'ok');
  runtime.write(
    `WithdrawAuth backup (SAVE SECURELY): positionId=${positionId} secret=${parsed}`,
    'ok',
  );
};
