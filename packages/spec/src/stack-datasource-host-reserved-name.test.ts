// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stack's `datasources` collection refuses a datasource named `default`
 * (#23634, triage's proxy ruling A).
 *
 * ## What was wrong
 *
 * `default` is the host's primary datasource: the runtime declares and
 * connects it itself, and `AppPlugin` refuses a stack that declares it in every
 * boot posture (with `OS_DATABASE_URL`, with `--dev`, on the standalone path).
 * Yet `defineStack` and `os validate` accepted that stack, so the refusal first
 * reached its author after the boot's earlier plugins had started.
 *
 * ## What is pinned
 *
 * - `defineStack` refuses the array form and the map form with the ADR-0112
 *   envelope (`STACK_SCHEMA_INVALID`, 422), one issue located at the entry's
 *   `name`, whose text carries the runtime's sentence and both remedies;
 * - the bare schema parse — the `os validate` door's — refuses it too;
 * - the reserved set is the runtime's comparison, `name === 'default'`:
 *   every other spelling of the word is refused by the name pattern already,
 *   never by this rule;
 * - CONTROL: a datasource named `fx_primary` passes;
 * - CONTROL: the host's own `default` row still parses through
 *   `DatasourceSchema`, which the refusal deliberately does not sit on.
 *
 * The `os validate` exit-code pin lives in
 * `packages/cli/test/stack-datasource-default-validate-door.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { defineStack, ObjectStackDefinitionSchema } from './stack.zod';
import { DatasourceSchema } from './data/datasource.zod';

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; message?: string }>;
};

function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = { id: 'com.example.fx', name: 'fx', version: '1.0.0', type: 'app' as const };
const sqlite = (name: string) => ({ name, driver: 'sqlite', config: { filename: `${name}.db` }, autoConnect: true });

const RUNTIME_SENTENCE = "declares a datasource named 'default' — that name is reserved for the host's primary datasource";

function expectReservedNameIssue(issues: Envelope['issues'], path: readonly PropertyKey[]): void {
  const hits = (issues ?? []).filter((i) => (i.message ?? '').includes(RUNTIME_SENTENCE));
  expect(hits).toHaveLength(1);
  expect(hits[0]!.code).toBe('custom');
  expect(hits[0]!.path).toEqual(path);
  expect(hits[0]!.message).toContain('OS_DATABASE_URL');
  expect(hits[0]!.message).toContain('declare it under another name');
}

describe('a stack datasource named `default` is refused at authoring', () => {
  it('defineStack refuses the array form — STACK_SCHEMA_INVALID / 422 at datasources.0.name', () => {
    const refused = refusal(() => defineStack({ manifest, datasources: [sqlite('default')] } as never));
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
    expectReservedNameIssue(refused?.issues, ['datasources', 0, 'name']);
  });

  it('defineStack refuses the map form — the key normalizes to `name`', () => {
    const { name: _name, ...body } = sqlite('default');
    const refused = refusal(() => defineStack({ manifest, datasources: { default: body } } as never));
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
    expectReservedNameIssue(refused?.issues, ['datasources', 0, 'name']);
  });

  it('names the entry it refuses, beside a legal one', () => {
    const refused = refusal(() =>
      defineStack({ manifest, datasources: [sqlite('fx_primary'), sqlite('default')] } as never),
    );
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expectReservedNameIssue(refused?.issues, ['datasources', 1, 'name']);
  });

  it('the bare schema parse (the os validate door) refuses it too', () => {
    const result = ObjectStackDefinitionSchema.safeParse({ manifest, datasources: [sqlite('default')] });
    expect(result.success).toBe(false);
    expectReservedNameIssue(result.error?.issues as Envelope['issues'], ['datasources', 0, 'name']);
  });

  it("the reserved set is the runtime's `name === 'default'`: other spellings meet the name pattern, not this rule", () => {
    for (const spelling of ['Default', 'DEFAULT', ' default', 'default ']) {
      const result = ObjectStackDefinitionSchema.safeParse({ manifest, datasources: [sqlite(spelling)] });
      expect(result.success, spelling).toBe(false);
      const messages = (result.error?.issues ?? []).map((i) => i.message);
      expect(messages.some((m) => m.includes(RUNTIME_SENTENCE)), spelling).toBe(false);
    }
  });

  it('CONTROL: a datasource named `fx_primary` passes', () => {
    const stack = defineStack({ manifest, datasources: [sqlite('fx_primary')] } as never);
    expect(stack.datasources?.map((d) => d.name)).toEqual(['fx_primary']);
  });

  it("CONTROL: the host's own `default` row still parses through DatasourceSchema", () => {
    const result = DatasourceSchema.safeParse(sqlite('default'));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data?.name).toBe('default');
  });
});
