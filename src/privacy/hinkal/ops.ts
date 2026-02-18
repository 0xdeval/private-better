import { ethers } from 'ethers';
import { emporiumOp } from '@hinkal/common';

export const buildPrivateSupplyOps = (params: {
  adapterAddress: string;
  tokenAddress: string;
  amount: bigint;
  zkOwnerHash: string;
  withdrawAuthHash: string;
}): string[] => {
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
};

export const buildPrivateWithdrawOp = (params: {
  adapterAddress: string;
  emporiumAddress: string;
  positionId: bigint;
  amount: bigint;
  withdrawAuthSecret: string;
  nextWithdrawAuthHash: string;
}): string => {
  const adapterInterface = new ethers.utils.Interface([
    'function withdrawToRecipient(uint256 positionId, uint256 amount, bytes32 withdrawAuthSecret, bytes32 nextWithdrawAuthHash, address recipient) returns (uint256)',
  ]);

  return emporiumOp({
    contract: params.adapterAddress,
    callDataString: adapterInterface.encodeFunctionData('withdrawToRecipient', [
      params.positionId,
      params.amount,
      params.withdrawAuthSecret,
      params.nextWithdrawAuthHash,
      params.emporiumAddress,
    ]),
  });
};
