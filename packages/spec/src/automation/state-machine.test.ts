import { describe, it, expect } from 'vitest';
import { StateMachineSchema } from './state-machine.zod';

describe('StateMachineSchema', () => {
  it('should validate a simple state machine', () => {
    const machine = {
      id: 'simple_flow',
      initial: 'start',
      states: {
        start: {
          on: {
            NEXT: 'end',
          },
        },
        end: {
          type: 'final',
        },
      },
    };

    const result = StateMachineSchema.parse(machine);
    expect(result.id).toBe('simple_flow');
    expect(result.initial).toBe('start');
  });

  it('should validate complex state machine with guards and actions', () => {
    const machine = {
      id: 'approval_flow',
      initial: 'draft',
      states: {
        draft: {
          on: {
            SUBMIT: {
              target: 'pending',
              cond: 'isComplete',
              actions: ['notifyManager'],
            },
          },
        },
        pending: {
          on: {
            APPROVE: 'approved',
            REJECT: 'rejected',
          },
          meta: {
            aiInstructions: 'Review carefully',
          },
        },
        approved: { type: 'final' },
        rejected: { type: 'final' },
      },
    };

    expect(() => StateMachineSchema.parse(machine)).not.toThrow();
  });

  it('should validate hierarchical states', () => {
    const machine = {
      id: 'nested_flow',
      initial: 'active',
      states: {
        active: {
          initial: 'running',
          states: {
            running: {
              on: { PAUSE: 'paused' },
            },
            paused: {
              on: { RESUME: 'running' },
            },
          },
          on: { STOP: 'stopped' },
        },
        stopped: { type: 'final' },
      },
    };

    expect(() => StateMachineSchema.parse(machine)).not.toThrow();
  });

  it('should validate parallel states', () => {
    const machine = {
      id: 'parallel_flow',
      initial: 'processing',
      states: {
        processing: {
          type: 'parallel',
          states: {
            upload: {
              initial: 'pending',
              states: {
                pending: { on: { START: 'uploading' } },
                uploading: { on: { DONE: 'uploaded' } },
                uploaded: { type: 'final' },
              },
            },
            validate: {
              initial: 'pending',
              states: {
                pending: { on: { CHECK: 'checking' } },
                checking: { on: { PASS: 'passed' } },
                passed: { type: 'final' },
              },
            },
          },
        },
      },
    };

    expect(() => StateMachineSchema.parse(machine)).not.toThrow();
  });

  it('should reject invalid identifier', () => {
    const machine = {
      id: 'Invalid Name',
      initial: 'start',
      states: {
        start: {},
      },
    };

    expect(() => StateMachineSchema.parse(machine)).toThrow();
  });
});

// ─── [#4658] `EventSchema` is gone from ./automation — dual-source C6 ────────
//
// `./automation` and `./kernel` both exported an `EventSchema`, for two
// declarations whose key sets did not even intersect:
//
//   automation/state-machine.zod.ts (removed) → `{ type, schema }` — an
//     XState-style signal DECLARATION ("which events does this machine
//     accept"). An orphan: `StateMachineSchema` names event types as the
//     record keys of `on:`, and no repo imported it (objectstack / cloud /
//     objectui, import-statement-level scan).
//   kernel/events/core.zod.ts → `{ id?, name, payload, metadata }` — an
//     event-bus ENVELOPE (an emitted event instance).
//
// Converging them would have declared a signal definition to be an envelope —
// a false statement in the contract — so the orphan was deleted instead
// (maintainer ruling on #4658; ledger #4535 C6). The kernel-side analogue of a
// signal *declaration* already exists: `EventTypeDefinitionSchema`, same file.
//
// #4642 established that a compile-time conditional-type pin in this package
// is a no-op (tsconfig excludes `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR (re-adding the export
// turns it red).
describe('[#4658] `EventSchema` is not exported from ./automation', () => {
  it('resolves the export surface: no entry but ./kernel declares `EventSchema`', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { readFileSync } = await import('node:fs');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    // Every public entry point, read from package.json's exports map so a
    // future entry cannot silently escape the uniqueness pin below.
    const pkg = JSON.parse(readFileSync(resolve(specDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const entries: Record<string, string> = {};
    for (const sub of Object.keys(pkg.exports)) {
      if (sub === '.') entries[sub] = resolve(specDir, 'src/index.ts');
      else if (/^\.\/[a-z-]+$/.test(sub)) entries[sub] = resolve(specDir, `src/${sub.slice(2)}/index.ts`);
      // './openapi.json' / './package.json' are not TypeScript entry points.
    }
    // Anti-vacuity: the enumeration must have found the real surface.
    expect(Object.keys(entries)).toContain('./automation');
    expect(Object.keys(entries)).toContain('./kernel');
    expect(Object.keys(entries).length).toBeGreaterThan(10);

    const program = ts.createProgram(Object.values(entries), {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const unalias = (s: import('typescript').Symbol) =>
      s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

    const exportsOf = (sub: string) => {
      const sf = program.getSourceFile(entries[sub]);
      const moduleSym = sf && checker.getSymbolAtLocation(sf);
      // Without this guard a resolution failure would make every assertion
      // below pass vacuously — the exact way a gate goes dormant (#4642).
      expect(moduleSym, `${sub} module symbol must resolve`).toBeTruthy();
      return checker.getExportsOfModule(moduleSym!);
    };

    const originOf = (sym: import('typescript').Symbol, label: string) => {
      const decl = unalias(sym).declarations?.[0];
      expect(decl, `${label} must have a declaration`).toBeTruthy();
      const declFile = decl!.getSourceFile();
      return `${relative(specDir, declFile.fileName)}:${
        declFile.getLineAndCharacterOfPosition(decl!.getStart()).line + 1
      }`;
    };

    // 1. The removed side: `./automation` still has a non-trivial surface —
    //    so the `not.toContain` cannot pass by resolving nothing — and no
    //    longer names `EventSchema`, while its surviving neighbours stand.
    const automationExports = exportsOf('./automation');
    expect(automationExports.length, './automation must export a non-trivial surface').toBeGreaterThan(50);
    const automationNames = automationExports.map((e) => e.getName());
    expect(automationNames).not.toContain('EventSchema');
    expect(automationNames).toContain('StateMachineSchema');
    expect(automationNames).toContain('TransitionSchema');

    // 2. The surviving side: `./kernel` still exports the envelope const and
    //    its inferred type, declared in kernel/events/core.zod.ts.
    const kernelExports = exportsOf('./kernel');
    const kernelEventSchema = kernelExports.find((e) => e.getName() === 'EventSchema');
    expect(kernelEventSchema, './kernel must export `EventSchema`').toBeTruthy();
    const kernelOrigin = originOf(kernelEventSchema!, './kernel EventSchema');
    expect(kernelOrigin).toMatch(/^src\/kernel\/events\/core\.zod\.ts:\d+$/);
    expect(kernelExports.map((e) => e.getName())).toContain('Event');

    // 3. Uniqueness — the dual-source pin proper: across EVERY public entry,
    //    an export named `EventSchema` must resolve to that ONE declaration.
    const holders: string[] = [];
    for (const sub of Object.keys(entries)) {
      for (const sym of exportsOf(sub).filter((e) => e.getName() === 'EventSchema')) {
        holders.push(sub);
        expect(
          originOf(sym, `${sub} EventSchema`),
          `${sub} must resolve \`EventSchema\` to the kernel declaration`,
        ).toBe(kernelOrigin);
      }
    }
    expect(holders).toContain('./kernel');
    expect(holders).not.toContain('./automation');
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const automation = await import('./index');
    const kernel = await import('../kernel/index');
    expect('EventSchema' in automation).toBe(false);
    expect('EventSchema' in kernel).toBe(true);

    // What the name now unambiguously means: an emitted event INSTANCE.
    expect(() =>
      kernel.EventSchema.parse({
        name: 'user.created',
        payload: { id: 'u1' },
        metadata: { source: 'test', timestamp: '2026-08-03T00:00:00.000Z' },
      }),
    ).not.toThrow();

    // The removed side's shape — a signal DECLARATION — is not what the
    // surviving schema accepts: the two concepts were never converged.
    expect(() => kernel.EventSchema.parse({ type: 'APPROVE' })).toThrow();
  });

  it('still authors state-machine event types as `on:` record keys — the surface the orphan never was', () => {
    const machine = {
      id: 'c6_pin',
      initial: 'draft',
      states: {
        draft: { on: { APPROVE: 'approved' } },
        approved: { type: 'final' },
      },
    };
    expect(() => StateMachineSchema.parse(machine)).not.toThrow();
  });
});
