// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generated object draft has to survive the platform's OWN validator.
 *
 * `generateObjectDraft` renders a `*.object.ts` a human is meant to review and
 * commit. Two things in that output made it un-committable:
 *
 *  1. the object name carried no `${namespace}_` prefix, so `defineStack()`
 *     refused it outright (ADR-0028) — measured on the pre-fix tree as
 *     `Object 'customers' is missing the package namespace prefix.`;
 *  2. no `sharingModel` was emitted, so the author-time rule set `os build`
 *     runs refused it (`security-owd-unset` at `objects[0].sharingModel`,
 *     ADR-0090 D1) — the same rule family #9666 hit for the `os init` template.
 *
 * ## Why the two are pinned SEPARATELY
 *
 * A single "the draft builds now" assertion cannot say which of the two it is
 * measuring, and cannot fail informatively when one of them regresses on its
 * own. Each defect therefore gets its own case, asserting its own signal.
 *
 * ## Why `still-generates` is here at all
 *
 * Both defects above are satisfiable by emitting LESS. An implementation that
 * returned a minimal valid stub — right name, right OWD, no fields — would go
 * green on a validator-only suite while destroying the only thing this
 * generator exists to do. The `still-generates` block is the counterweight:
 * the introspected columns, the remote table name and the `external` binding
 * are asserted to survive the fix.
 *
 * ## The instrument
 *
 * The prefix assertion calls `validateObjectNamespacePrefix` — the same
 * function `defineStack()` and the runtime publish gate call — rather than
 * re-spelling `startsWith`. A hand-rolled check here could pass while the real
 * gate refuses, which is precisely the drift that produced defect (1).
 * The OWD assertion runs a full `ObjectSchema.safeParse`, because what is
 * being guarded is a VALUE's verdict, not merely a key's presence.
 */

import { describe, it, expect } from 'vitest';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  ExternalDatasourceService,
  type DatasourceLike,
  type ExternalDatasourceServiceConfig,
} from '../external-datasource-service.js';

/**
 * A remote schema with an ALREADY-prefixed table alongside a bare one, so the
 * double-prefix case (`wh_wh_accounts`) is reachable from the same fixture.
 *
 * Hand-written rather than driven off a live `SqlDriver` — deliberately, and
 * for a different reason than the blindness `external-introspection-seam.test.ts`
 * exists to close. Neither defect pinned here reads a column's PK-ness at all:
 * the object NAME comes from the table name and the OWD is a constant, so a
 * real introspection would add cost and no coverage.
 *
 * Every column is spelled `primaryKey: false` on purpose. That keeps the whole
 * file on the `opts.primaryKey`-unset path, where the generator emits no
 * `fields.<f>.primaryKey` — the key that is NOT authorable (#11000, an open
 * contract question in `packages/spec`, deliberately untouched here). Pinning
 * these two repairs on a draft that also carries #11000's key would produce
 * cases that cannot go green until a card this lane does not own is decided.
 */
function remoteSchema(): IntrospectedSchema {
  return {
    dialect: 'postgres',
    introspectedAt: '2026-08-22T00:00:00.000Z',
    tables: {
      'mart.customers': {
        name: 'mart.customers',
        indexes: [],
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: false },
          { name: 'name', type: 'varchar(255)', nullable: true, primaryKey: false },
          { name: 'signed_up_at', type: 'timestamptz', nullable: true, primaryKey: false },
        ],
      },
      'mart.wh_accounts': {
        name: 'mart.wh_accounts',
        indexes: [],
        columns: [{ name: 'id', type: 'text', nullable: false, primaryKey: false }],
      },
    },
  };
}

/**
 * The service wired exactly as `plugin.ts` wires it, with the namespace
 * resolution the plugin injects made explicit per-test.
 *
 * `namespace: undefined` is NOT the same as omitting `getNamespace`: the first
 * is "a resolver ran and found nothing", the second is "no resolver at all".
 * Both must land on the bare name, and both are exercised below.
 */
function serviceWith(
  namespace?: string | undefined,
  opts: { wireResolver?: boolean } = {},
): ExternalDatasourceService {
  const config: ExternalDatasourceServiceConfig = {
    introspect: async () => remoteSchema(),
    getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
    getObject: async () => undefined,
    listObjects: async () => [],
    ...(opts.wireResolver === false ? {} : { getNamespace: () => namespace }),
  };
  return new ExternalDatasourceService(config);
}

/** The canonical OWD values, read off the live schema rather than restated. */
const CANONICAL_OWD: readonly string[] = (
  ObjectSchema.shape.sharingModel as unknown as { def: { innerType: { options: string[] } } }
).def.innerType.options;

describe('defect 1 — the generated object name carries the package namespace prefix', () => {
  it('prefixes the derived name, and the SINGLE-SOURCE rule accepts it', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');

    expect(draft.name).toBe('wh_customers');
    // The instrument that matters: the very function `defineStack()` calls.
    expect(validateObjectNamespacePrefix(draft.name, 'wh')).toBeNull();
    // …and the rendered file agrees with the structured definition.
    expect(draft.definition.name).toBe('wh_customers');
    expect(draft.source).toContain("name: 'wh_customers'");
    expect(draft.source).toContain('const wh_customers: ServiceObject = {');
  });

  it('does NOT double-prefix a remote table that already carries the namespace', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'wh_accounts');

    expect(draft.name).toBe('wh_accounts');
    expect(draft.name).not.toContain('wh_wh_');
    expect(validateObjectNamespacePrefix(draft.name, 'wh')).toBeNull();
  });

  it('keeps the LABEL derived from the short name — the prefix is addressing, not display', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');
    expect(draft.definition.label).toBe('Customers');
  });
});

describe('defect 2 — the generated draft declares an explicit sharingModel', () => {
  it('emits the OWD the #9666 precedent settled on, and the spec accepts the VALUE', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');

    expect(draft.definition.sharingModel).toBe('private');
    // Not just "some string": a value the canonical enum still declares. If
    // ADR-0090's four ever change, this reddens instead of drifting.
    expect(CANONICAL_OWD).toContain(draft.definition.sharingModel);

    // A value verdict needs a full parse, not an absence-of-unknown-keys check.
    const parsed = ObjectSchema.safeParse(draft.definition);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });

  it('renders the OWD into the committed source, with the reason attached', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');

    expect(draft.source).toContain("sharingModel: 'private'");
    expect(draft.source).toContain('security-owd-unset');
  });

  it('emits the OWD even when no namespace resolves — the two defects are independent', async () => {
    const draft = await serviceWith(undefined).generateObjectDraft('warehouse', 'customers');
    expect(draft.definition.sharingModel).toBe('private');
    expect(draft.source).toContain("sharingModel: 'private'");
  });
});

describe('still-generates — the fix must not be satisfied by emitting a valid stub', () => {
  it('keeps every introspected column, its mapped type, and the review notes', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');
    const fields = draft.definition.fields as Record<string, { type: string }>;

    expect(Object.keys(fields)).toEqual(['id', 'name', 'signed_up_at']);
    expect(fields.id.type).toBe('text');
    expect(fields.name.type).toBe('text');
    expect(fields.signed_up_at.type).toBe('datetime');

    expect(draft.source).toContain("id: { type: 'text' }");
    expect(draft.source).toContain("signed_up_at: { type: 'datetime' }");
  });

  it('keeps the external binding pointed at the REMOTE table, not the renamed object', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');
    const external = draft.definition.external as { remoteName?: string; remoteSchema?: string };

    // The object was renamed to `wh_customers`; the remote table was not.
    expect(external.remoteName).toBe('customers');
    expect(external.remoteSchema).toBe('mart');
    expect(draft.definition.datasource).toBe('warehouse');
    expect(draft.source).toContain("remoteSchema: 'mart', remoteName: 'customers'");
  });
});

describe('an absent or blank namespace must not trade one invalid draft for another', () => {
  /**
   * `_customers` is the failure mode this block exists to forbid: a name that
   * satisfies "has a prefix" while being neither valid nor meaningful. The
   * bare name is the defensible outcome — `defineStack()` skips the prefix
   * check entirely for a stack with no `manifest.namespace`, and deliberately
   * does not invent one on the author's behalf, so the draft stays committable
   * exactly where an unprefixed name is legal.
   */
  it.each([
    ['no resolver wired at all', undefined, false],
    ['a resolver that finds nothing', undefined, true],
    ['an empty string', '', true],
    ['whitespace only', '   ', true],
  ])('%s → the bare name, never a leading underscore', async (_label, ns, wired) => {
    const draft = await serviceWith(ns as string | undefined, {
      wireResolver: wired as boolean,
    }).generateObjectDraft('warehouse', 'customers');

    expect(draft.name).toBe('customers');
    expect(draft.name.startsWith('_')).toBe(false);
    expect(draft.source).not.toContain('_customers:');
    expect(ObjectSchema.safeParse(draft.definition).success).toBe(true);
  });

  it('says so loudly in the rendered file rather than failing silently', async () => {
    const draft = await serviceWith(undefined).generateObjectDraft('warehouse', 'customers');

    expect(draft.source).toContain('TODO(namespace)');
    expect(draft.source).toContain('ADR-0028');
  });

  it('carries NO namespace TODO once a namespace did resolve', async () => {
    const draft = await serviceWith('wh').generateObjectDraft('warehouse', 'customers');
    expect(draft.source).not.toContain('TODO(namespace)');
  });
});

describe('importObject inherits both repairs from the draft pipeline', () => {
  it('persists the prefixed name and the explicit OWD', async () => {
    const persisted: Array<{ name: string; def: Record<string, unknown> }> = [];
    const svc = new ExternalDatasourceService({
      introspect: async () => remoteSchema(),
      getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
      getObject: async () => undefined,
      listObjects: async () => [],
      getNamespace: () => 'wh',
      persistObject: async (name, def) => {
        persisted.push({ name, def });
      },
    });

    const result = await svc.importObject('warehouse', 'customers');

    expect(result.name).toBe('wh_customers');
    expect(persisted[0]?.name).toBe('wh_customers');
    expect(persisted[0]?.def.sharingModel).toBe('private');
    expect(ObjectSchema.safeParse(persisted[0]?.def).success).toBe(true);
  });
});
