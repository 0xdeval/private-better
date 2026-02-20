import { WebCliRuntime } from '../runtime';

export const helpCommand = (runtime: WebCliRuntime) => {
  runtime.write('Commands:', 'muted');
  runtime.write('help');
  runtime.write('get-started');
  runtime.write('clear');
  runtime.write('login');
  runtime.write('login-test [mnemonic] -> uses VITE_LOGIN_TEST_MNEMONIC when arg is omitted');
  runtime.write('import <mnemonic>');
  runtime.write('approve <amount> e.g. approve 1.5');
  runtime.write('shield <amount> e.g. shield 1.5');
  runtime.write('unshield <amount> [recipient] e.g. unshield 0.5');
  runtime.write('unshield-weth <amount> [recipient] e.g. unshield-weth 0.01');
  runtime.write('private-balance [usdc|weth]');
  runtime.write('private-supply <amount> e.g. private-supply 1.0');
  runtime.write('supply-positions');
  runtime.write(
    'position-auth <positionId> [withdrawAuth] -> show or set auth secret backup',
  );
  runtime.write(
    'private-withdraw <positionId> <amount|max> [withdrawAuth] e.g. private-withdraw 1 max',
  );
  runtime.write(
    'private-borrow <positionId> <amount> [withdrawAuth] e.g. private-borrow 1 0.01',
  );
  runtime.write(
    'private-repay <positionId> <amount> [withdrawAuth] e.g. private-repay 1 0.005',
  );
  runtime.write('', 'muted');
};
