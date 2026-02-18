import { BigNumber, Contract, ethers } from 'ethers';

import { ADAPTER_ABI, ERC20_ABI } from '../abis';
import { formatTokenAmount, parseTokenAmount } from '../amounts';
import { WebCliRuntime } from '../runtime';

export const privateSupplyCommand = async (
  runtime: WebCliRuntime,
  amountText: string | undefined,
) => {
  if (!amountText) throw new Error('Usage: private-supply <amount>');
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();

  const session = runtime.requireActiveSession();
  const amount = parseTokenAmount(amountText);
  const adapterAddress = runtime.getAdapterAddress();
  const tokenAddress = runtime.getSupplyTokenAddress();
  const emporiumAddress = runtime.getEmporiumAddress();

  const { provider, signerAddress } = await runtime.getSigner();
  runtime.assertSessionEoa(session, signerAddress);
  const signer = await runtime.getBoundSigner(provider, signerAddress);
  await runtime.validatePrivateSupplyConfig(provider, adapterAddress, tokenAddress, emporiumAddress);

  runtime.write('Building private supply transaction...', 'muted');
  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider) as any;
  const erc20 = new Contract(tokenAddress, ERC20_ABI, provider) as any;
  const spender = await runtime.manager.getShieldSpender({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });
  const [publicBalance, allowanceToSpender] = await Promise.all([
    erc20.balanceOf(signerAddress),
    erc20.allowance(signerAddress, spender),
  ]);
  runtime.debug(
    `private-supply preflight: publicBalance=${formatTokenAmount(publicBalance)} allowanceToHinkal=${formatTokenAmount(allowanceToSpender)}`,
  );

  const privateSpendableBalance = await runtime.manager.getPrivateSpendableBalance({
    mnemonic: session.mnemonic,
    tokenAddress,
    publicWallet: signer,
  });
  const privateActionContext = await runtime.manager.getPrivateActionContext({
    mnemonic: session.mnemonic,
    publicWallet: signer,
  });
  const zkOwnerHash = runtime.getZkOwnerHash(session.privateAddress);

  if (privateSpendableBalance < amount) {
    throw new Error(
      `Insufficient private spendable balance. Need ${amountText}, available ${formatTokenAmount(privateSpendableBalance)}.`,
    );
  }

  const withdrawAuthSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const withdrawAuthHash = ethers.utils.keccak256(withdrawAuthSecret);
  const supplyOps = runtime.buildPrivateSupplyOps({
    adapterAddress,
    tokenAddress,
    amount,
    zkOwnerHash,
    withdrawAuthHash,
  });
  const estimatedFlatFee = await runtime.estimateEmporiumFlatFee({
    walletAddress: privateActionContext.subAccountAddress,
    feeTokenAddress: tokenAddress,
    erc20Addresses: [tokenAddress],
    ops: supplyOps,
  });

  if (estimatedFlatFee != null) {
    const { reserve } = runtime.getBufferedFeeReserve(estimatedFlatFee);
    const requiredTotal = amount + reserve;
    runtime.write(
      `Fee estimate (supply): flatFee=${formatTokenAmount(estimatedFlatFee)} reserve=${formatTokenAmount(reserve)} required=${formatTokenAmount(requiredTotal)}`,
      'muted',
    );
    runtime.debugFeeEstimate('supply-fee', estimatedFlatFee, reserve, requiredTotal);
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
    txHash = await runtime.manager.privateSupply({
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
  runtime.write(`Private supply tx: ${txHash}`, 'ok');

  const afterIdsRaw = await adapter.getOwnerPositionIds(zkOwnerHash, 0, 500);
  const afterIds = afterIdsRaw[0] as BigNumber[];
  const createdId = afterIds.find((id) => !beforeSet.has(id.toString())) ?? afterIds.at(-1);
  if (createdId != null) {
    session.positionSecrets[createdId.toString()] = withdrawAuthSecret;
    await runtime.saveActiveSession();
    runtime.write(`Position created: ${createdId.toString()} (withdraw secret stored locally).`, 'ok');
    return;
  }

  runtime.write('Supply tx confirmed, but could not auto-detect new position id. Run supply-positions.', 'muted');
};

export const supplyPositionsCommand = async (runtime: WebCliRuntime) => {
  await runtime.ensureTargetNetwork();
  const session = runtime.requireActiveSession();
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
      `- #${id.toString()} token=${token} vault=${vault} amount=${formatTokenAmount(amount)} secret=${hasLocalSecret ? 'yes' : 'no'}`,
    );
  }
};

export const privateWithdrawCommand = async (
  runtime: WebCliRuntime,
  positionIdText: string | undefined,
  amountText: string | undefined,
) => {
  if (!positionIdText || !amountText) {
    throw new Error('Usage: private-withdraw <positionId> <amount|max>');
  }

  const session = runtime.requireActiveSession();
  await runtime.ensureTargetNetwork();
  await runtime.ensurePrivacyInitialized();

  const adapterAddress = runtime.getAdapterAddress();
  const emporiumAddress = runtime.getEmporiumAddress();
  const tokenAddress = runtime.getSupplyTokenAddress();
  const positionId = BigInt(positionIdText);
  const isMaxWithdraw = amountText.toLowerCase() === 'max';
  const currentSecret = session.positionSecrets[positionId.toString()];
  if (!currentSecret) {
    throw new Error(
      `No local withdraw secret found for position ${positionId.toString()}. Use supply-positions and ensure this browser created the position.`,
    );
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

  let amount = isMaxWithdraw ? positionAmount : parseTokenAmount(amountText);
  if (!isMaxWithdraw && amount > positionAmount) {
    throw new Error(
      `Withdraw amount exceeds position balance. Requested ${amountText}, available ${formatTokenAmount(positionAmount)}.`,
    );
  }

  const nextSecret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const nextWithdrawAuthHash = ethers.utils.keccak256(nextSecret);
  const [privateSpendableBalance, privateActionContext] = await Promise.all([
    runtime.manager.getPrivateSpendableBalance({
      mnemonic: session.mnemonic,
      tokenAddress,
      publicWallet: signer,
    }),
    runtime.manager.getPrivateActionContext({
      mnemonic: session.mnemonic,
      publicWallet: signer,
    }),
  ]);
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
    feeTokenAddress: tokenAddress,
    erc20Addresses: [tokenAddress],
    ops: withdrawOps,
  });
  if (estimatedFlatFee != null) {
    const { reserve } = runtime.getBufferedFeeReserve(estimatedFlatFee);
    runtime.write(
      `Fee estimate (withdraw): flatFee=${formatTokenAmount(estimatedFlatFee)} reserve=${formatTokenAmount(reserve)} requiredPrivateBalance=${formatTokenAmount(reserve)}`,
      'muted',
    );
    runtime.debugFeeEstimate('withdraw-fee', estimatedFlatFee, reserve, reserve);
    if (privateSpendableBalance < reserve) {
      throw new Error(
        `Insufficient private spendable balance for withdraw fee reserve. Need ${formatTokenAmount(reserve)}, available ${formatTokenAmount(privateSpendableBalance)}. Shield more USDC before withdrawing.`,
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
    runtime.debug(
      `private-withdraw max fallback: retrying with ${formatTokenAmount(amount)} due to Aave available-balance rounding`,
    );
    txHash = await runtime.manager.privateWithdraw({
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
    `Position ${positionId.toString()} updated. Remaining amount=${formatTokenAmount(remainingAmount)}. Secret rotated.`,
    'ok',
  );
};
