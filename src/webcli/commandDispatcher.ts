import { WebCliRuntime } from './runtime';
import { helpCommand } from './commands/helpCommand';
import {
  approveCommand,
  importCommand,
  loginCommand,
  privateBalanceCommand,
  shieldCommand,
  unshieldCommand,
} from './commands/accountCommands';
import {
  privateSupplyCommand,
  privateWithdrawCommand,
  supplyPositionsCommand,
} from './commands/positionCommands';

export const executeCommand = async (runtime: WebCliRuntime, raw: string): Promise<void> => {
  const [cmd, ...args] = raw.split(/\s+/);

  try {
    switch (cmd) {
      case 'help':
        helpCommand(runtime);
        return;
      case 'clear':
        runtime.clear();
        return;
      case 'login':
        await loginCommand(runtime);
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
      case 'private-supply':
        await privateSupplyCommand(runtime, args[0]);
        return;
      case 'private-balance':
        await privateBalanceCommand(runtime);
        return;
      case 'supply-positions':
        await supplyPositionsCommand(runtime);
        return;
      case 'private-withdraw':
        await privateWithdrawCommand(runtime, args[0], args[1]);
        return;
      default:
        runtime.write(`Unknown command: ${cmd}. Type help.`, 'err');
    }
  } catch (error) {
    runtime.write(`Error: ${runtime.formatError(error)}`, 'err');
  }
};
