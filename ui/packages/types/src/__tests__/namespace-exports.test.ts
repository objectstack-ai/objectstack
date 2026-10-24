/**
 * Test to verify ObjectStack Spec v3.0.0 namespace exports
 */
import { describe, it, expect } from 'vitest';

describe('ObjectStack Spec v3.0.0 Namespace Exports', () => {
  it('should export Data namespace', async () => {
    const types = await import('../index');
    // Data namespace should exist and have content
    expect(types).toHaveProperty('defineStack');
  });

  it('should export UI types via spec', async () => {
    // Verify that types can be imported from @object-ui/types
    const types = await import('../index');
    // defineStack should be exported
    expect(typeof types.defineStack).toBe('function');
  });

  it('should export ObjectStack schemas', async () => {
    const types = await import('../index');
    expect(types.ObjectStackSchema).toBeDefined();
    expect(types.ObjectStackDefinitionSchema).toBeDefined();
  });

  it('should export VERSION constant', async () => {
    const types = await import('../index');
    expect(types.VERSION).toBeDefined();
  });
});
