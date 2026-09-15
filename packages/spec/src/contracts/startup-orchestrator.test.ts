import { describe, it, expect } from 'vitest';
import type { PluginStartupResult } from './startup-orchestrator';
// [#4538] The contract's data shape IS the kernel zod type — the same
// declaration, re-exported. This import compiling is part of the pin.
import { PluginStartupResultSchema } from '../kernel/startup-orchestrator.zod';

// [#16059] `IStartupOrchestrator` and the three data schemas it tied together
// (`StartupOptions`, `HealthStatus`, `StartupOrchestrationResult`) are retired
// under ADR-0049 — nothing implemented the interface, nothing parsed the
// schemas, and `checkHealth` was the interface of a probe system that does not
// exist. Their absence is pinned in
// `../kernel/startup-orchestrator-retirement.test.ts`; what this file still
// covers is the one shape that survived, on the entry that re-exports it.
describe('Startup Orchestrator Contract — the surviving result shape', () => {
  it('types a successful startup with the plugin NAME', () => {
    const result: PluginStartupResult = {
      pluginName: 'auth-plugin',
      success: true,
      durationMs: 150,
    };

    expect(result.success).toBe(true);
    expect(result.pluginName).toBe('auth-plugin');
    expect(result.durationMs).toBe(150);
    expect(result.error).toBeUndefined();
  });

  it('types the no-start() path, where durationMs is absent', () => {
    const result: PluginStartupResult = {
      pluginName: 'inert-plugin',
      success: true,
    };

    expect(result.durationMs).toBeUndefined();
  });

  it('types a timed-out startup with a SERIALIZABLE error (#4538)', () => {
    const result: PluginStartupResult = {
      pluginName: 'broken-plugin',
      success: false,
      durationMs: 30000,
      // The kernel schema declares the serializable projection — what a
      // wire/log consumer of the result can carry.
      error: { name: 'Error', message: 'Timeout' },
      timedOut: true,
    };

    expect(result.success).toBe(false);
    expect(result.error!.message).toBe('Timeout');
    expect(result.timedOut).toBe(true);
  });

  it('a live Error satisfies the declared projection — what the kernel hands through', () => {
    // `ObjectKernel.startPluginWithTimeout()` puts the thrown instance in
    // `error` so the boot loop can rethrow it as the new error's `cause`. That
    // is legal against this contract because `Error` IS a
    // `{ name, message, stack? }` — the projection is what a consumer may
    // rely on, not a narrowing of what the kernel may pass.
    const thrown = new Error('Connection failed');
    const result: PluginStartupResult = {
      pluginName: 'db-plugin',
      success: false,
      error: thrown,
    };

    expect(result.error instanceof Error).toBe(true);
    expect(result.error!.name).toBe('Error');
  });

  it('is the SAME declaration the kernel entry exports (#4538)', () => {
    const value: PluginStartupResult = { pluginName: 'x', success: true };
    const parsed = PluginStartupResultSchema.safeParse(value);
    expect(parsed.success).toBe(true);
  });
});
