// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every refusal `defineStack` raises carries an ADR-0112 envelope (#15963).
 *
 * ## What was wrong
 *
 * `defineStack` has seven refusal sites. After #14552 one of them — the
 * cross-reference refusal, pinned in `stack-cross-reference-envelope.test.ts`
 * — carried `code` / `status`; the other six threw `new Error(message)` with
 * both `undefined`. A consumer that had learned to branch on `error.code`
 * therefore read `undefined` from six of the seven, which reads as "not a
 * validation refusal" rather than "a refusal with no code yet" — exactly the
 * silent-tolerance shape the envelope exists to remove.
 *
 * ## What is pinned
 *
 * Per site: the ENVELOPE (`code`, `status: 422`); the message header
 * byte-for-byte (this change adds fields, it rewords nothing — the pins in
 * `stack.test.ts` and `stack-requires.test.ts` read that prose); `issues`
 * carrying one entry per finding; and the CONTROL — the same fixture with the
 * one offending detail removed is accepted, so a refusal cannot satisfy the
 * assertions for the wrong reason. Then a census over all seven sites: seven
 * distinct `STACK_*` codes, every `status` 422, and no `name` spelled
 * `ValidationError`, which `validationFailureDetails` (`@objectstack/types`)
 * would duck-type as a RECORD-validation failure and answer as
 * `400 VALIDATION_FAILED` + `fields[]`.
 *
 * The schema arm is asserted on its own: its `issues` are the zod issues
 * themselves (path + message per entry), not formatted lines, and their count
 * is the count the header states.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

/** The error shape every assertion below reads — the ADR-0112 envelope. */
type Envelope = Error & { code?: string; status?: number; issues?: readonly unknown[] };

/** The thrown value, or `null` when the stack is accepted. */
function refusal(config: unknown, options?: { strict?: boolean }): Envelope | null {
  try {
    defineStack(config as never, options);
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = {
  id: 'com.example.refusalenvelopes',
  name: 'refusal-envelopes-test',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'probe',
};

/** The stack's ONE declared object, correctly prefixed for `manifest.namespace`. */
const task = {
  name: 'probe_task',
  label: 'Task',
  fields: { title: { type: 'text' as const, label: 'Title' } },
};

const app = (name: string) => ({
  name,
  label: name,
  navigation: [{ id: `nav_${name}`, type: 'object' as const, label: 'Tasks', objectName: task.name }],
});

/** A `record_change` flow — auto-launched, so it owes `requires: ['triggers']`. */
const recordFlow = {
  name: 'task_fanout',
  label: 'task_fanout',
  type: 'record_change',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'start',
      config: { objectName: task.name, triggerType: 'record-after-create' },
    },
    { id: 'end', type: 'end', label: 'end' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/**
 * One row per semantic refusal site. `refused` and `accepted` differ by the one
 * detail the site checks; `finding` is a verbatim fragment of the one `issues`
 * entry the refusal must carry.
 */
const rows: Array<{
  site: string;
  code: string;
  header: string;
  refused: Record<string, unknown>;
  accepted: Record<string, unknown>;
  finding: string;
}> = [
  {
    site: 'capability — `requires` names a token no runtime provides',
    code: 'STACK_CAPABILITY_UNKNOWN',
    header: 'defineStack capability validation failed',
    refused: { manifest, objects: [task], requires: ['automations'] },
    accepted: { manifest, objects: [task], requires: ['automation'] },
    finding: "'automations' is not a known platform capability",
  },
  {
    site: 'namespace-prefix — an object name lacks the manifest.namespace prefix',
    code: 'STACK_NAMESPACE_PREFIX_INVALID',
    header: 'defineStack namespace-prefix validation failed',
    refused: { manifest, objects: [{ ...task, name: 'task' }] },
    accepted: { manifest, objects: [task] },
    finding: "Rename it to 'probe_task'",
  },
  {
    site: 'single-app — an app package declares more than one app',
    code: 'STACK_SINGLE_APP_VIOLATION',
    header: 'defineStack single-app validation failed',
    refused: { manifest, objects: [task], apps: [app('app_one'), app('app_two')] },
    accepted: { manifest, objects: [task], apps: [app('app_one')] },
    finding: 'at most one app',
  },
  {
    site: 'hierarchy-scope capability — a HIERARCHY scope without hierarchy-security',
    code: 'STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED',
    header: 'defineStack hierarchy-scope capability validation failed',
    refused: {
      manifest,
      objects: [task],
      permissions: [
        { name: 'managers', label: 'Managers', objects: { [task.name]: { allowRead: true, readScope: 'unit_and_below' } } },
      ],
    },
    accepted: {
      manifest,
      objects: [task],
      requires: ['hierarchy-security'],
      permissions: [
        { name: 'managers', label: 'Managers', objects: { [task.name]: { allowRead: true, readScope: 'unit_and_below' } } },
      ],
    },
    finding: "uses readScope='unit_and_below', a HIERARCHY scope",
  },
  {
    site: 'trigger capability — an auto-launched flow without triggers',
    code: 'STACK_TRIGGER_CAPABILITY_REQUIRED',
    header: 'defineStack trigger capability validation failed',
    refused: { manifest, objects: [task], requires: ['automation'], flows: [recordFlow] },
    accepted: { manifest, objects: [task], requires: ['automation', 'triggers'], flows: [recordFlow] },
    finding: "flow 'task_fanout' declares a 'record_change' trigger",
  },
];

describe('#15963 — every defineStack refusal carries an ADR-0112 envelope', () => {
  for (const row of rows) {
    describe(row.site, () => {
      it(`refuses with code ${row.code} and status 422`, () => {
        const refused = refusal(row.refused);
        expect(refused).toBeInstanceOf(Error);
        expect(refused?.code).toBe(row.code);
        expect(refused?.status).toBe(422);
      });

      it('keeps the message header byte-for-byte, with the issue count', () => {
        const refused = refusal(row.refused);
        expect(refused?.message).toMatch(new RegExp(`^${row.header} \\(1 issue\\):`));
        expect(refused?.message).toContain(row.finding);
      });

      it('carries the finding in `issues`, one entry per finding', () => {
        const refused = refusal(row.refused);
        expect(refused?.issues).toHaveLength(1);
        expect(refused?.issues?.[0]).toContain(row.finding);
      });

      it('the same stack without the one offending detail is ACCEPTED — the control', () => {
        expect(refusal(row.accepted)).toBeNull();
      });
    });
  }

  describe('namespace-prefix — the hint is message-only', () => {
    it('the writing-style hint stays in the message and out of `issues`', () => {
      const refused = refusal(rows[1].refused);
      const hint = 'Every object.name must be';
      expect(refused?.message).toContain(hint);
      expect(refused?.issues?.[0]).not.toContain(hint);
    });
  });

  describe('schema — the zod parse itself failed (judged separately, see StackSchemaInvalidError)', () => {
    const refused = { manifest: {} };
    const accepted = { manifest, objects: [task] };

    it('refuses with code STACK_SCHEMA_INVALID and status 422', () => {
      const envelope = refusal(refused);
      expect(envelope).toBeInstanceOf(Error);
      expect(envelope?.code).toBe('STACK_SCHEMA_INVALID');
      expect(envelope?.status).toBe(422);
    });

    it('keeps the message header byte-for-byte and carries the zod issues STRUCTURALLY, count matching the header', () => {
      const envelope = refusal(refused);
      const match = /^defineStack validation failed \((\d+) issues?\):/.exec(envelope?.message ?? '');
      expect(match).not.toBeNull();
      const count = Number(match?.[1]);
      expect(count).toBeGreaterThan(0);
      expect(envelope?.issues).toHaveLength(count);
      for (const issue of envelope?.issues ?? []) {
        const zodIssue = issue as { path?: unknown; message?: unknown };
        expect(Array.isArray(zodIssue.path)).toBe(true);
        expect(typeof zodIssue.message).toBe('string');
      }
    });

    it('a stack that parses is ACCEPTED — the control', () => {
      expect(refusal(accepted)).toBeNull();
    });
  });

  describe('census over all seven refusal sites', () => {
    const crossReference = { manifest, objects: [task], data: [{ object: 'missing_object', records: [] }] };
    const everySite = [...rows.map((r) => r.refused), { manifest: {} }, crossReference];

    it('seven sites, seven distinct STACK_* codes, every status 422', () => {
      const envelopes = everySite.map((config) => refusal(config));
      for (const envelope of envelopes) {
        expect(envelope).toBeInstanceOf(Error);
        expect(envelope?.code).toMatch(/^STACK_[A-Z_]+$/);
        expect(envelope?.status).toBe(422);
      }
      expect(new Set(envelopes.map((e) => e?.code)).size).toBe(7);
      expect(envelopes.map((e) => e?.code)).toContain('STACK_CROSS_REFERENCE_INVALID');
    });

    it('no site is named `ValidationError` — the record-validation duck-type in @objectstack/types', () => {
      for (const config of everySite) {
        expect(refusal(config)?.name).not.toBe('ValidationError');
      }
    });
  });

  it('non-strict mode skips validation by contract — no envelope, no refusal', () => {
    expect(refusal({ requires: ['automations'] }, { strict: false })).toBeNull();
  });
});
