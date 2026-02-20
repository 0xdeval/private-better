import { WebCliRuntime } from '../runtime';

export const getStartedForJudgesCommand = (runtime: WebCliRuntime) => {
    runtime.write('To test Hush with a pre-paid account:', 'muted');
    runtime.write('1) login-test', 'muted');
    runtime.write('2) private-balance usdc', 'muted');
    runtime.write('3) private-supply 1', 'muted');
    runtime.write('4) supply-positions', 'muted');
    runtime.write('5) private-borrow <positionId> 0.01', 'muted');
    runtime.write('6) private-repay <positionId> 0.005', 'muted');
    runtime.write('', 'muted');
};
