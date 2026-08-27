import { describe, it, expect } from 'vitest';
import { OclifPluginConfigSchema } from './cli-extension.zod';

// [#12007] The `CLICommandContributionSchema` block that used to sit here left
// with the retired export (ADR-0049 enforce-or-remove) — the rejection/holder
// pins live in `cli-command-contribution-retirement.test.ts`.
describe('OclifPluginConfigSchema', () => {
  it('should accept valid oclif plugin config', () => {
    const result = OclifPluginConfigSchema.parse({
      commands: {
        strategy: 'pattern',
        target: './dist/commands',
        glob: '**/*.js',
      },
    });
    expect(result.commands?.strategy).toBe('pattern');
    expect(result.commands?.target).toBe('./dist/commands');
  });

  it('should accept config with topicSeparator', () => {
    const result = OclifPluginConfigSchema.parse({
      commands: { strategy: 'pattern' },
      topicSeparator: ' ',
    });
    expect(result.topicSeparator).toBe(' ');
  });

  it('should accept empty config', () => {
    const result = OclifPluginConfigSchema.parse({});
    expect(result).toBeDefined();
  });

  it('should accept config with only commands', () => {
    const result = OclifPluginConfigSchema.parse({
      commands: {
        strategy: 'explicit',
      },
    });
    expect(result.commands?.strategy).toBe('explicit');
  });

  it('should reject invalid strategy', () => {
    expect(() => OclifPluginConfigSchema.parse({
      commands: { strategy: 'invalid' },
    })).toThrow();
  });
});
