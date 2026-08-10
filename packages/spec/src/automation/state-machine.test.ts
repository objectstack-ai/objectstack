import { describe, it, expect } from 'vitest';
import {
  StateMachineSchema,
  StateNodeSchema,
  TransitionSchema,
  ActionRefSchema,
  GuardRefSchema,
} from './state-machine.zod';
import { AgentSchema } from '../ai/agent.zod';
import { formatZodError } from '../shared/error-map.zod';
import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
  maybeOriginOf,
  originFileOf,
  originOf,
  originsOf,
  runtimeParityOf,
} from '../../scripts/lib/export-origins-testkit';

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

// ─── [#4001 批 10] unknown keys are rejected, not stripped ──────────────────
//
// The ledger carried these six shapes as `authorable (p)` — provisional. The
// `(p)` had to be resolved before tightening (verify-before-tightening), and
// resolving it was not a formality: ADR-0020 RETIRED this XState shape as a
// record-lifecycle declaration, so the top-level `workflow` metadata type and
// `object.stateMachines` are both gone and a record's transitions live on the
// `state_machine` VALIDATION RULE instead. Had those been the only doors, this
// file would be dead surface and the correct action would have been to fix its
// ledger class, not to close it.
//
// The surviving door is `ai/agent.zod.ts`'s `lifecycle` — and `agent` is a
// registered metadata type, so `defineStack({ agents })`, the meta REST write
// and the Studio agent form all `.parse()` through here. The first test below
// IS that verification, kept executable rather than written down.
describe('[#4001] the authoring door — agent.lifecycle', () => {
  const agent = (lifecycle: unknown) => ({
    name: 'probe_agent', label: 'Probe', role: 'assistant', instructions: 'do things', lifecycle,
  });

  it('a well-formed lifecycle still parses through AgentSchema', () => {
    const parsed = AgentSchema.parse(agent({
      id: 'probe_machine',
      initial: 'draft',
      states: {
        draft: { on: { APPROVE: 'done' }, meta: { aiInstructions: 'Review carefully' } },
        done: { type: 'final' },
      },
    }));
    expect((parsed.lifecycle as { states: Record<string, unknown> }).states).toHaveProperty('draft');
  });

  // The measurement that resolved `(p)` to `authorable`. Before this batch the
  // parse below SUCCEEDED, returning
  //   { id, initial, states: { draft: { type: 'atomic', meta: {} }, done: … } }
  // — `stats` gone, both `meta` keys gone, and `onn` (one keystroke from `on`)
  // gone with every transition the author declared. A machine whose whole job
  // is to deny undeclared transitions had become one with NO transitions, and
  // reported success. All three depths must now refuse.
  it('refuses undeclared keys at all three depths, through the agent door', () => {
    const result = AgentSchema.safeParse(agent({
      id: 'probe_machine',
      initial: 'draft',
      stats: { runs: 3 },
      states: {
        draft: { onn: { APPROVE: 'done' }, meta: { labell: 'Draft', owner: 'ops' } },
        done: { type: 'final' },
      },
    }));
    expect(result.success).toBe(false);

    const messages = result.error!.issues.map((i) => i.message).join('\n');
    // machine level, state-node level, meta level — and each names its own
    // surface, so the author is told WHICH of the three nested shapes refused.
    expect(messages).toContain('this state machine');
    expect(messages).toContain('this state node');
    expect(messages).toContain('this state node meta block');
    // Every one of the three carries a usable rename.
    expect(messages).toContain('`stats` → `states`');
    expect(messages).toContain('`onn` → `on`');
    expect(messages).toContain('`labell` → `label`');
  });
});

describe('[#4001] state-machine strictness — per shape', () => {
  it('StateMachine: `context` gets a wrong-layer prescription, NOT a rename', () => {
    const result = StateMachineSchema.safeParse({
      id: 'mm', initial: 's', states: { s: {} }, context: { amount: 0 },
    });
    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    // XState's `context` holds initial VALUES; `contextSchema` declares a
    // SHAPE. A rename here would tell the author to write their values where a
    // schema goes — so the entry states both halves and offers no rename.
    expect(message).toContain('INITIAL VALUES');
    expect(message).toContain('contextSchema');
    expect(message).not.toContain('Did you mean');
  });

  it('StateNode: `transitions` is pointed at `on`, and at the OTHER declaration', () => {
    const result = StateNodeSchema.safeParse({ transitions: { draft: ['done'] } });
    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    expect(message).toContain('`on`');
    // The word `transitions` is not invented — it is the key on the object-level
    // `state_machine` validation rule, which is the neighbouring declaration an
    // author most plausibly arrives from. Saying so is the whole value.
    expect(message).toContain('validations[].transitions');
  });

  it('Transition: `guard` → `cond` needs the alias — edit distance cannot reach it', () => {
    const result = TransitionSchema.safeParse({ target: 'approved', guard: 'isManager' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`guard` → `cond`');
  });

  it('Transition: a plain typo still rides the edit-distance fallback', () => {
    const result = TransitionSchema.safeParse({ target: 'approved', action: ['notify'] });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`action` → `actions`');
  });

  // `meta` was the one shape in this file that had to be argued rather than
  // measured-and-closed: XState treats `meta` as an open bag, and the #4909
  // precedent says a genuinely-open slot should SAY `.passthrough()`. It is
  // closed here because the hand-written `StateNodeConfig` type declares
  // exactly these four keys (passthrough would open the Zod while `tsc` stayed
  // shut), because nothing in the repo reads any `meta` key, and because the
  // pre-existing behaviour was not openness but strip — an author's `meta`
  // arrived as `{}`. There was no openness to preserve.
  it('StateNode.meta is CLOSED — the four declared keys and no bag', () => {
    expect(() => StateNodeSchema.parse({
      meta: { label: 'L', description: 'D', color: '#fff', aiInstructions: 'A' },
    })).not.toThrow();

    const result = StateNodeSchema.safeParse({ meta: { label: 'L', tooltip: 'T' } });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('this state node meta block');
  });
});

// The union branches behave measurably differently from the plain shapes, and
// the difference is zod's, not this file's. Pinned in BOTH directions so the
// next reader does not "fix" the quietness by reopening the branch, and so a
// future improvement to the flattening consumers is noticed here first.
describe('[#4001] ActionRef / GuardRef — strict inside a union', () => {
  it.each([
    ['ActionRef', ActionRefSchema, 'this action reference'],
    ['GuardRef', GuardRefSchema, 'this guard reference'],
  ] as const)('%s: the object branch rejects an unknown key', (_label, schema, surface) => {
    // The string branch is untouched — it has no keys to be strict about.
    expect(() => schema.parse('isManager')).not.toThrow();
    expect(() => schema.parse({ type: 'log', params: { a: 1 } })).not.toThrow();

    const result = schema.safeParse({ type: 'log', args: { a: 1 } });
    expect(result.success).toBe(false);

    // The union raises ONE issue, and its own message is the bare zod string.
    const issue = result.error!.issues[0] as { code: string; message: string; errors?: unknown[][] };
    expect(issue.code).toBe('invalid_union');
    expect(issue.message).toBe('Invalid input');

    // …with the real prescription intact one level down. This is the assertion
    // that keeps "quieter" from decaying into "silent".
    const nested = (issue.errors ?? []).flat() as Array<{ message: string }>;
    const prose = nested.map((i) => i.message).join('\n');
    expect(prose).toContain(surface);
    expect(prose).toContain('`args`');
  });

  // Anti-vacuity for the claim above: a PLAIN strictObject in this same file
  // surfaces its prose through the same formatter, so anything the union
  // renders differently is a property of the union and not of the curation.
  //
  // ⚠️ THIS PIN WAS FLIPPED BY #4971, exactly as 批 10 predicted it would be.
  // It used to assert the second half was flattened away — `formatZodError`
  // mapped `error.issues` and never descended into `invalid_union.errors`, so
  // the curated rejection stopped at `✗ (root): Invalid input` on the CLI path
  // while the REST body and `ZodError.message` carried it fine. The formatter
  // now expands the union's most informative branch, and the two halves say
  // the same thing again. What is still union-shaped is the extra `Invalid
  // input` line above the prescription: zod raises one issue for the union,
  // and that line is what says "no branch matched".
  it('CONTROL — union and non-union shapes both render their prescription through formatZodError', () => {
    const plain = TransitionSchema.safeParse({ target: 't', guard: 'isX' });
    expect(formatZodError(plain.error!)).toContain('`guard` → `cond`');

    const union = ActionRefSchema.safeParse({ type: 'log', args: { a: 1 } });
    const formatted = formatZodError(union.error!);
    expect(formatted).toContain('Invalid input');
    expect(formatted).toContain('this action reference');
    expect(formatted).toContain('`args`');
    // The string branch's "expected string, received object" is not a
    // prescription and is not printed — see #4971's branch selection.
    expect(formatted).not.toContain('expected string');
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
// was a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR (re-adding the export
// turns it red).
describe('[#4658] `EventSchema` is not exported from ./automation', () => {
  it('resolves the export surface: no entry but ./kernel declares `EventSchema`', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796.)
    expect(EXPORT_ENTRY_POINTS).toContain('./automation');
    expect(EXPORT_ENTRY_POINTS).toContain('./kernel');
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // 1. The removed side: `./automation` still has a non-trivial surface —
    //    so the `not.toContain` cannot pass by resolving nothing — and no
    //    longer names `EventSchema`, while its surviving neighbours stand.
    const automationNames = exportNamesOf('./automation');
    expect(automationNames.length, './automation must export a non-trivial surface').toBeGreaterThan(50);
    expect(automationNames).not.toContain('EventSchema');
    expect(automationNames).toContain('StateMachineSchema');
    expect(automationNames).toContain('TransitionSchema');

    // 2. The surviving side: `./kernel` still exports the envelope const and
    //    its inferred type, declared in kernel/events/core.zod.ts.
    expect(maybeOriginOf('./kernel', 'EventSchema'), './kernel must export `EventSchema`').toBeDefined();
    expect(originFileOf('./kernel', 'EventSchema')).toBe('src/kernel/events/core.zod.ts');
    expect(exportNamesOf('./kernel')).toContain('Event');

    // 3. Uniqueness — the dual-source pin proper: across EVERY public entry,
    //    an export named `EventSchema` must resolve to that ONE declaration.
    expect(originsOf('EventSchema')).toEqual([originOf('./kernel', 'EventSchema')]);
    const holders = holdersOf('EventSchema');
    expect(holders).toContain('./kernel');
    expect(holders).not.toContain('./automation');
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const automation = await import('./index');
    const kernel = await import('../kernel/index');
    expect('EventSchema' in automation).toBe(false);
    expect('EventSchema' in kernel).toBe(true);

    // The compiler-free half of the baseline's freshness guard: a stale or
    // hand-edited `export-origins/` that moved or invented a runtime export is
    // caught here, in `pnpm test`, without waiting for `check:export-origins`.
    expect(runtimeParityOf('./automation', automation)).toEqual({ missingAtRuntime: [], missingFromArtifact: [] });
    expect(runtimeParityOf('./kernel', kernel)).toEqual({ missingAtRuntime: [], missingFromArtifact: [] });

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
