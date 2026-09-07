// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defineStack`'s cross-reference refusal carries an ADR-0112 envelope
 * (`code` + `status`), not a bare `Error`.
 *
 * ## What was wrong
 *
 * `validateCrossReferences` collects every dangling reference a stack declares
 * — an item naming an object the stack does not define — and `defineStack`
 * raised the collected set as `new Error(message)`. `code` and `status` were
 * both `undefined`, so the five REFUSED item classes of the ADR-0130 matrix
 * (action `objectName`, view `data.object`, permission-set `objects`, seed
 * dataset `object`, import mapping `targetObject`) plus the `hooks[].object`
 * rule were distinguishable only by MESSAGE TEXT. ADR-0112 makes `code` /
 * `status` the machine-readable half of a refusal precisely so that prose does
 * not have to be load-bearing; `os validate`, `os build` and any AI author
 * reading the refusal had nothing else to match on.
 *
 * ## Why ONE code and not five
 *
 * There is exactly ONE raise site: `validateCrossReferences` returns a
 * `string[]` and `defineStack` throws the whole set as a single aggregated
 * error. A refusal can therefore carry issues from SEVERAL classes at once,
 * which is why the code names the rule family (the cross-reference gate) and
 * not one member of it — a per-class code on an aggregate throw would have to
 * pick one of several true answers. The individual classes stay legible in
 * `issues`, one entry per finding, which is the machine-readable form of what
 * previously existed only as newline-joined prose.
 *
 * The set is also WIDER than "undefined object": the same aggregate carries the
 * duplicate-action-key and global-`update`-action findings, and the mapping
 * `javascript`-transform refusal. `STACK_CROSS_REFERENCE_UNDEFINED_OBJECT`
 * would be false for those, so the family spelling is the honest one.
 *
 * ## What is pinned
 *
 * The ENVELOPE (`code`, `status`), never the message alone — a bare
 * `toThrow()` cannot tell "refused for the right reason" from "refused because
 * the fixture is broken", and both precedents for this defect class
 * (`ObjectOwnershipConflictError`, `NamespaceConflictError`) are asserted the
 * same way. The message text is pinned as UNCHANGED beside it: this change adds
 * fields, it does not reword a sentence, and five message-substring pins
 * elsewhere in the tree read it.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

const manifest = {
  id: 'com.example.crossrefenvelope',
  name: 'cross-reference-envelope-test',
  version: '1.0.0',
  type: 'app' as const,
};

/**
 * The stack's ONE declared object. Every fixture below names `missing_object`
 * instead — the single difference between a refused stack and an accepted one.
 */
const declared = {
  name: 'probe_item',
  label: 'Probe Item',
  fields: { title: { type: 'text' as const } },
};

/** The name no fixture declares, so every reference to it dangles. */
const MISSING = 'missing_object';

/** The error shape every assertion below reads — the ADR-0112 envelope. */
type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

/** The thrown value, or `null` when the stack is accepted. */
function refusal(config: Parameters<typeof defineStack>[0]): Envelope | null {
  try {
    defineStack(config);
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const stackWith = (extra: Record<string, unknown>) =>
  ({ manifest, objects: [declared], ...extra }) as unknown as Parameters<typeof defineStack>[0];

/**
 * One row per refused item class. `message` is the verbatim line the aggregate
 * must still contain — the byte-for-byte fence on the prose.
 */
const rows: Array<{ label: string; config: Record<string, unknown>; message: string }> = [
  {
    label: 'hooks[].object (#14122 §4 rule R4)',
    config: {
      hooks: [{ name: 'probe_hook', object: MISSING, events: ['afterInsert'], handler: 'noop' }],
    },
    message: `Hook 'probe_hook' references object '${MISSING}' which is not defined in objects.`,
  },
  {
    label: 'view data.object',
    config: {
      views: [
        {
          name: 'probe_view',
          label: 'Probe View',
          list: { columns: [{ field: 'title' }], data: { provider: 'object', object: MISSING } },
        },
      ],
    },
    message: `View[0].list references object '${MISSING}' which is not defined in objects.`,
  },
  {
    label: 'seed dataset object',
    config: { data: [{ object: MISSING, records: [] }] },
    message: `Seed data references object '${MISSING}' which is not defined in objects.`,
  },
  {
    label: 'import mapping targetObject',
    config: {
      mappings: [{ name: 'probe_mapping', targetObject: MISSING, fieldMapping: [] }],
    },
    message: `Mapping 'probe_mapping' targets object '${MISSING}' which is not defined in objects.`,
  },
  {
    label: 'permission set objects',
    config: {
      permissions: [{ name: 'probe_perm', label: 'Probe Perm', objects: { [MISSING]: { allowRead: true } } }],
    },
    message: `Permission 'probe_perm' grants on object '${MISSING}' which is not defined in objects.`,
  },
  {
    label: 'action objectName',
    config: {
      actions: [{ name: 'probe_action', label: 'Probe Action', type: 'script', target: 'noop', objectName: MISSING }],
    },
    message: `Action 'probe_action' references object '${MISSING}' which is not defined in objects.`,
  },
];

describe('#14552 — defineStack cross-reference refusals carry an ADR-0112 envelope', () => {
  for (const row of rows) {
    describe(row.label, () => {
      it('refuses with code STACK_CROSS_REFERENCE_INVALID and status 422', () => {
        const refused = refusal(stackWith(row.config));
        expect(refused).toBeInstanceOf(Error);
        expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
        expect(refused?.status).toBe(422);
      });

      it('keeps the message text byte-for-byte, header and line', () => {
        const refused = refusal(stackWith(row.config));
        expect(refused?.message).toContain('defineStack cross-reference validation failed');
        expect(refused?.message).toContain(row.message);
      });

      it('carries the finding in `issues`, one entry per finding', () => {
        const refused = refusal(stackWith(row.config));
        expect(refused?.issues).toContain(row.message);
      });
    });
  }

  it('the same object declared makes the stack ACCEPTED — the fixtures differ by one name', () => {
    // The control: without it, a fixture broken in some unrelated way would
    // satisfy every refusal assertion above for the wrong reason.
    const accepted = refusal(
      stackWith({ data: [{ object: declared.name, records: [] }] }),
    );
    expect(accepted).toBeNull();
  });

  it('an aggregate spanning TWO classes carries one code and BOTH findings', () => {
    // Why the code names the rule family and not one item class: a single
    // throw can carry findings from several classes at once.
    const refused = refusal(
      stackWith({
        data: [{ object: MISSING, records: [] }],
        mappings: [{ name: 'probe_mapping', targetObject: MISSING, fieldMapping: [] }],
      }),
    );
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toHaveLength(2);
  });
});
