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
import Explain from '../src/commands/explain';

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
