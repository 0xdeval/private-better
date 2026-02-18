import { WebCliRuntime } from '../runtime';

export const helpCommand = (runtime: WebCliRuntime) => {
  runtime.write('Commands:', 'muted');
  runtime.write('help');
  runtime.write('clear');
  runtime.write('login');
  runtime.write('import <mnemonic>');
  runtime.write('approve <amount> e.g. approve 1.5');
  runtime.write('shield <amount> e.g. shield 1.5');
  runtime.write('unshield <amount> [recipient] e.g. unshield 0.5');
  runtime.write('private-balance');
  runtime.write('private-supply <amount> e.g. private-supply 1.0');
  runtime.write('supply-positions');
  runtime.write(
    'private-withdraw <positionId> <amount|max> e.g. private-withdraw 1 max',
  );
};
