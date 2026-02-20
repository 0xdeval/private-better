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
  privateRepayCommand,
  privateSupplyCommand,
  privateWithdrawCommand,
  supplyPositionsCommand,
} from './commands/positionCommands';
import { getStartedForJudgesCommand } from './commands/getStartedForJudgesCommand';

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
        await loginCommand(runtime);
        return;
      case 'login-test':
        await loginTestCommand(runtime, args.join(' '));
        return;
      case 'import':
        await importCommand(runtime, args.join(' '));
        return;
      case 'approve':
        await approveCommand(runtime, args[0]);
        return;
      case 'shield':
        await shieldCommand(runtime, args[0]);
        return;
      case 'unshield':
        await unshieldCommand(runtime, args[0], args[1]);
        return;
      case 'unshield-weth':
        await unshieldWethCommand(runtime, args[0], args[1]);
        return;
      case 'private-supply':
        await privateSupplyCommand(runtime, args[0]);
        return;
      case 'private-balance':
        await privateBalanceCommand(runtime, args[0]);
        return;
      case 'supply-positions':
        await supplyPositionsCommand(runtime);
        return;
      case 'private-withdraw':
        await privateWithdrawCommand(runtime, args[0], args[1]);
        return;
      case 'private-borrow':
        await privateBorrowCommand(runtime, args[0], args[1]);
        return;
      case 'private-repay':
        await privateRepayCommand(runtime, args[0], args[1]);
        return;
      default:
        runtime.write(`Unknown command: ${cmd}. Type 'help' or 'get-started'`, 'err');
    }
  } catch (error) {
    runtime.write(`Error: ${runtime.formatError(error)}`, 'err');
  }
};
