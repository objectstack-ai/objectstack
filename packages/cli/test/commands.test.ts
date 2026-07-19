import { describe, it, expect } from 'vitest';
import Compile from '../src/commands/compile';
import Serve from '../src/commands/serve';
import Dev from '../src/commands/dev';
import Doctor from '../src/commands/doctor';
import Create from '../src/commands/create';
import Test from '../src/commands/test';
import Validate from '../src/commands/validate';
import Init from '../src/commands/init';
import Info from '../src/commands/info';
import Generate from '../src/commands/generate';
import Lint from '../src/commands/lint';
import Diff from '../src/commands/diff';
import Explain, { SCHEMAS } from '../src/commands/explain';

describe('CLI Commands (oclif)', () => {
  it('should have compile command', () => {
    expect(Compile.description).toContain('Compile');
  });

  it('should have serve command', () => {
    expect(Serve.description).toContain('server');
  });

  it('should have dev command', () => {
    expect(Dev.description).toContain('development mode');
  });

  it('should have doctor command', () => {
    expect(Doctor.description).toContain('health');
  });

  it('should have create command', () => {
    expect(Create.description).toContain('Create');
  });

  it('should have test command', () => {
    expect(Test.description).toContain('Quality Protocol');
  });

  it('should have validate command', () => {
    expect(Validate.description).toContain('Validate');
  });

  it('should have init command', () => {
    expect(Init.description).toContain('Initialize');
  });

  it('should have info command', () => {
    expect(Info.description).toContain('summary');
  });

  it('should have generate command with alias', () => {
    expect(Generate.aliases).toContain('g');
    expect(Generate.description).toContain('Generate');
  });

  it('should have lint command', () => {
    expect(Lint.description).toContain('style');
  });

  it('should have diff command', () => {
    expect(Diff.description).toContain('Compare');
  });

  it('should have explain command', () => {
    expect(Explain.description).toContain('explanation');
  });
});

describe('os explain — schema catalog accuracy', () => {
  // Regression guard for #3244: `os explain object` used to document the
  // `ownership` field as the package-contribution kind (`"own" | "extend"`),
  // which is a DISTINCT concept (`ObjectOwnershipEnum`, set via registerObject).
  // The real `ObjectSchema.ownership` field is the record-ownership model —
  // `z.enum(['user','org','none'])` — see packages/spec/src/data/object.zod.ts.
  it('documents object.ownership as the record-ownership model, not the own/extend contribution kind (#3244)', () => {
    const ownership = SCHEMAS.object.optional.find((f) => f.name === 'ownership');
    expect(ownership, 'object schema should document an `ownership` field').toBeDefined();

    // The type string must enumerate exactly the record-ownership enum values.
    const tokens = (ownership!.type.match(/'[^']+'|"[^"]+"/g) ?? []).map((t) => t.slice(1, -1));
    expect(new Set(tokens)).toEqual(new Set(['user', 'org', 'none']));

    // …and must never regress back to the contribution-kind values.
    expect(ownership!.type).not.toBe('"own" | "extend"');
  });
});
