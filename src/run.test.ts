import { describe, expect, it, vi } from 'vitest';
import { runGenerateCli } from './run';

describe('runGenerateCli', () => {
  it('test_runGenerateCli_when_called_should_delegate_to_runPhase7Cli', async () => {
    const runPhase7Cli = vi.fn(async () => {});
    const phase7Options = { exitFn: vi.fn() };

    await runGenerateCli({ runPhase7Cli, phase7Options });

    expect(runPhase7Cli).toHaveBeenCalledTimes(1);
    expect(runPhase7Cli).toHaveBeenCalledWith(phase7Options);
  });
});
