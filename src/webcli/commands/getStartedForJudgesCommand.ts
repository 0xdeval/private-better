import { WebCliRuntime } from '../runtime';

export const getStartedForJudgesCommand = (runtime: WebCliRuntime) => {
    runtime.write('To test Hush with a pre-paid account:', 'muted');
    runtime.write('1) To login to a pre-paid account, run `login-test`', 'muted');
    runtime.write('2) To check your private USDC balance, run `private-balance usdc`', 'muted');
    runtime.write('3) To supply 1 USDC to Aave, run `private-supply 1`', 'muted');
    runtime.write('4) To list your supply positions, run `supply-positions`', 'muted');
    runtime.write('5) To borrow 0.000005 WETH from a position, run `private-borrow <positionId> 0.000005 <withdrawAuth>`', 'muted');
    runtime.write('6) To check your private WETH balance, run `private-balance weth`', 'muted');
    runtime.write('7) To repay 0.000005 WETH to a position, run `private-repay <positionId> 0.000005 <withdrawAuth>`', 'muted');
    runtime.write('8) To withdraw 1 WETH from a position, run `private-withdraw <positionId> 1 <withdrawAuth>`', 'muted');
    runtime.write('', 'muted');
};
