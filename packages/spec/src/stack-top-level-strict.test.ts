// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8687 — the TOP-LEVEL stack door refuses unknown keys (maintainer-ruled
 * Shape B, 2026-08-16).
 *
 * Before this close, `ObjectStackDefinitionSchema` was the last strip-mode
 * surface of the #4001 campaign: an unknown top-level key parsed green and its
 * value was silently dropped. The card's own measurement on 17.0.0 GA: three
 * injected bogus top-level keys added ZERO warnings to `os validate` and
 * exited 0 — even `--strict` could not catch them, because the `defineStack:`
 * diagnostic printed at load, outside the warning tally. This file pins the
 * inversion of exactly that measurement, plus the accept side that must not
 * move.
 *
 * ## Rejection-pin convention (the standing minimum)
 *
 * Each rejection asserts the Zod issue's **`code` and `path`** (and the
 * offending key via `keys`/message). `status` is the publish door's uniform
 * wrap — the ADR-0112 envelope is applied where a parse failure crosses the
 * HTTP boundary, not minted per-schema — so at this layer it is stated as the
 * family convention rather than asserted.
 *
 * ## `validate --strict` subsumption (Shape B subsumes Shape A)
 *
 * A strict parse failure fails `os validate` outright (`safeParse` failure →
 * exit 1, with or without `--strict`), so no warning-accounting change is
 * needed. The CLI-level exit-code pin lives in
 * `packages/cli/test/validate-top-level-strict.e2e.test.ts`; this file pins
 * the schema layer those commands share.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackDefinitionSchema, defineStack } from './stack.zod';
import { lintUnknownStackKeys } from './kernel/metadata-authoring-lint';

/** A legal, representative stack touching several collections. */
const legalStack = () => ({
  manifest: { id: 'com.example.probe', name: 'probe', version: '1.0.0', type: 'app' as const, namespace: 'probe' },
  objects: [{ name: 'probe_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
  views: [],
  apps: [],
  flows: [],
  requires: ['automation'],
});

const parseTopLevel = (raw: Record<string, unknown>) => ObjectStackDefinitionSchema.safeParse(raw);

describe('#8687 — unknown top-level stack keys are refused at parse', () => {
  it("inverts the card's measured control: the three bogus keys now FAIL parse instead of adding zero warnings", () => {
    // Measured on 17.0.0 GA: each of these parsed `success: true` with the key
    // silently dropped, and injecting all three into a real app config added
    // ZERO warnings (88 → 88, identical sets) with exit 0 even under --strict.
    for (const key of ['flow', 'approvalProcesses', 'totallyBogusTopLevelKey']) {
      const result = parseTopLevel({ ...legalStack(), [key]: [] });
      expect(result.success, `'${key}' must now refuse at parse`).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue, `'${key}' must raise unrecognized_keys`).toBeDefined();
      expect(issue!.code).toBe('unrecognized_keys');
      // The refusal is raised at the object root — the envelope level itself.
      expect(issue!.path).toEqual([]);
      expect((issue as unknown as { keys: string[] }).keys).toContain(key);
      expect(issue!.message).toContain(`\`${key}\``);
    }
  });

  it('positive control: the same stack without the stray key parses green', () => {
    expect(parseTopLevel(legalStack()).success).toBe(true);
  });

  it("carries the near-miss guidance through the refusal: `objectz` → did you mean `objects`", () => {
    // The resolver used to speak through `lintUnknownStackKeys` as a load-time
    // warning; after the strict close the lint goes quiet (posture rule) and
    // the SAME did-you-mean rides the refusal message itself.
    const result = parseTopLevel({ objectz: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(issue.message).toContain('Did you mean `objectz` → `objects`?');
  });

  it('suggests the plural for a one-character singular miss (`flow` → `flows`)', () => {
    const result = parseTopLevel({ flow: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(issue.message).toContain('Did you mean `flow` → `flows`?');
  });

  it('answers the curated retirements with their prescriptions, not a rename', () => {
    const cases: ReadonlyArray<[key: string, mustContain: string]> = [
      // The #4167 worked example: where the setting DOES live.
      ['storage', 'OS_STORAGE_'],
      // ADR-0019: approvals are Approval-node flows.
      ['approvals', 'ADR-0019'],
      ['approvalProcesses', 'ADR-0019'],
      // ADR-0020: record state machines are a validation rule.
      ['workflows', 'state_machine'],
      // #3464: the collection was removed outright.
      ['portals', '#3464'],
      // #4212: the uninvoked lifecycle family.
      ['onDisable', '#4212'],
    ];
    for (const [key, mustContain] of cases) {
      const result = parseTopLevel({ [key]: [] });
      expect(result.success, `'${key}' must refuse`).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys')!;
      expect(issue.message, `'${key}' prescription`).toContain(mustContain);
      expect(issue.message, `'${key}' must not get a rename suggestion`).not.toContain('Did you mean');
    }
  });

  it('names where the legal keys are enumerated', () => {
    const result = parseTopLevel({ totallyBogusTopLevelKey: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(issue.message).toContain('ObjectStackDefinitionSchema');
  });
});

describe('#8687 — the accept side does not move', () => {
  it('accepts every declared top-level key', () => {
    // Structural sweep: a declared key must never be refused as unknown. All
    // 40+ top-level keys are optional (tombstones included), so presence with
    // `undefined` isolates exactly the door being tested.
    const shape = (ObjectStackDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape;
    const keys = Object.keys(shape);
    expect(keys.length).toBeGreaterThan(40); // non-vacuity
    for (const key of keys) {
      const result = parseTopLevel({ [key]: undefined });
      expect(result.success, `declared key '${key}' must stay accepted`).toBe(true);
    }
  });

  it('keeps the runtime members: `onEnable` and `functions` parse green — and `onEnable` now survives', () => {
    // `onEnable` was undeclared-but-honoured (STACK_RUNTIME_MEMBERS): the
    // parse stripped it while AppPlugin executed it off the authored bundle.
    // A strict close of an undeclared `onEnable` would have refused the
    // pattern our own examples ship, so #8687 declares it: accepted at parse,
    // and — new — retained in the parsed output (declared = honoured). JSON
    // serialization still drops it from artifacts, as ever (#4095 grafts).
    const onEnable = () => {};
    const result = parseTopLevel({ ...legalStack(), onEnable, functions: { doThing: () => {} } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(typeof (result.data as { onEnable?: unknown }).onEnable).toBe('function');
  });

  it('parses a legal stack without adding or dropping top-level keys', () => {
    // "Byte-identical" at the level this PR touches: the top-level key set is
    // preserved exactly. Item-level defaults (`field.required: false`, …) are
    // the pre-existing ADR-0122 parse behaviour, unchanged here.
    const fixture = legalStack();
    const result = parseTopLevel(fixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data).sort()).toEqual(Object.keys(fixture).sort());
    expect(result.data.requires).toEqual(fixture.requires);
    expect(result.data.objects![0]!.name).toBe('probe_task');
  });
});

describe('#8687 — one voice: the lint yields to the strict parse', () => {
  it('lintUnknownStackKeys goes quiet on the now-strict stack schema (its own posture rule)', () => {
    // The graduation day the lint's docblock always promised: a strict schema
    // rejects loudly on its own, so the lint must not become a second,
    // possibly disagreeing voice. The guidance lives in the refusal now.
    expect(lintUnknownStackKeys({ storage: {} }, ObjectStackDefinitionSchema)).toEqual([]);
    expect(lintUnknownStackKeys({ objectz: [] }, ObjectStackDefinitionSchema)).toEqual([]);
  });
});

describe('#8687 — defineStack surfaces the refusal', () => {
  it('throws with the curated message, did-you-mean included', () => {
    expect(() => defineStack({ objectz: [] } as never)).toThrowError(
      /Unrecognized key\(s\) on this stack definition: `objectz`\. Did you mean `objectz` → `objects`\?/,
    );
  });

  it('still parses the legal stack (control)', () => {
    expect(() => defineStack(legalStack() as never)).not.toThrow();
  });
});
