import { WebCliRuntime } from './runtime';
import { helpCommand } from './commands/helpCommand';
import {
  approveCommand,
  importCommand,
  loginCommand,
  loginTestCommand,
  privateBalanceCommand,
  shieldCommand,
  unshieldWethCommand,
  unshieldCommand,
} from './commands/accountCommands';
import {
  privateBorrowCommand,
  positionAuthCommand,
  privateRepayCommand,
  privateSupplyCommand,
  privateWithdrawCommand,
  supplyPositionsCommand,
} from './commands/positionCommands';
import { getStartedForJudgesCommand } from './commands/getStartedForJudgesCommand';

const COMMANDS_WITH_SPINNER = new Set([
  'login',
  'login-test',
  'approve',
  'shield',
  'unshield',
  'private-supply',
  'private-withdraw',
  'private-borrow',
  'private-repay',
  'private-balance',
  'privcate-balance',
]);

const withOptionalSpinner = async (
  runtime: WebCliRuntime,
  cmd: string,
  action: () => Promise<void>,
  text: string = 'waiting for confirmation...',
) => {
  if (!COMMANDS_WITH_SPINNER.has(cmd)) {
    await action();
    return;
  }

  await runtime.withSpinner(`[${cmd}] ${text}`, action);
};

export const executeCommand = async (runtime: WebCliRuntime, raw: string): Promise<void> => {
  const [cmd, ...args] = raw.split(/\s+/);

  try {
    switch (cmd) {
      case 'help':
        helpCommand(runtime);
        return;
      case 'get-started':
        getStartedForJudgesCommand(runtime);
        return;
      case 'clear':
        runtime.clear();
        return;
      case 'login':
        await withOptionalSpinner(runtime, cmd, () => loginCommand(runtime), 'logging in to your account...');
        return;
      case 'login-test':
        await withOptionalSpinner(runtime, cmd, () => loginTestCommand(runtime, args.join(' ')), 'logging in to a pre-paid account...');
        return;
      case 'import':
        await withOptionalSpinner(runtime, cmd, () => importCommand(runtime, args.join(' ')), 'importing your private wallet...');
        return;
      case 'approve':
        await withOptionalSpinner(runtime, cmd, () => approveCommand(runtime, args[0]), 'approving your funds...');
        return;
      case 'shield':
        await withOptionalSpinner(runtime, cmd, () => shieldCommand(runtime, args[0]), 'shielding your funds...');
        return;
      case 'unshield':
        await withOptionalSpinner(runtime, cmd, () => unshieldCommand(runtime, args[0], args[1]), 'unshielding your funds...');
        return;
      case 'unshield-weth':
        await withOptionalSpinner(runtime, cmd, () => unshieldWethCommand(runtime, args[0], args[1]), 'unshield your WETH...');
        return;
      case 'private-supply':
        await withOptionalSpinner(runtime, cmd, () => privateSupplyCommand(runtime, args[0]), 'privately moving your funds to AAVE...');
        return;
      case 'private-balance':
        await withOptionalSpinner(runtime, cmd, () => privateBalanceCommand(runtime, args[0]), 'fetching your private balance...');
        return;
      case 'supply-positions':
        await withOptionalSpinner(runtime, cmd, () => supplyPositionsCommand(runtime), 'fetching supplied positions...');
        return;
      case 'position-auth':
        await withOptionalSpinner(
          runtime,
          cmd,
          () => positionAuthCommand(runtime, args[0], args[1]),
          'reading/storing position auth secret...',
        );
        return;
      case 'private-withdraw':
        await withOptionalSpinner(
          runtime,
          cmd,
          () => privateWithdrawCommand(runtime, args[0], args[1], args[2]),
          'withdrawing your funds from AAVE...',
        );
        return;
      case 'private-borrow':
        await withOptionalSpinner(
          runtime,
          cmd,
          () => privateBorrowCommand(runtime, args[0], args[1], args[2]),
          'privately borrowing WETH from AAVE...',
        );
        return;
      case 'private-repay':
        await withOptionalSpinner(
          runtime,
          cmd,
          () => privateRepayCommand(runtime, args[0], args[1], args[2]),
          'repaying WETH to AAVE...',
        );
        return;
      default:
        runtime.write(`Unknown command: ${cmd}. Type 'help' or 'get-started'`, 'err');
    }
  } catch (error) {
    runtime.write(`Error: ${runtime.formatError(error)}`, 'err');
  }
};
