// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 — the override declaration `overrides: { package, basedOn }`.
 *
 * Three facts, each measured rather than assumed:
 *
 *  1. the shape accepts the declaration and refuses every malformed one;
 *  2. every type the closed list classifies `overridable` carries the key
 *     through the parse the metadata door's save runs (the stored body), and a
 *     type it excludes refuses it by name;
 *  3. the key survives `defineStack()` and the package export's view channel.
 *     (The export's own top-level strip is pinned in `@objectstack/runtime`,
 *     `domains/packages-export-override-declaration.test.ts`.)
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OverrideDeclarationSchema, OverrideDeclarationFields, CUSTOMIZATION_PACKAGE_SUFFIX } from './override-declaration.zod';
import { OVERRIDE_TYPE_CLASSIFICATION, OVERRIDABLE_METADATA_TYPES } from './customization-package';
import { getMetadataTypeSchema } from './metadata-type-schemas';
import { getMetadataCreateSeed } from './metadata-create-seeds';
import { MetadataProtectionFields } from './metadata-protection.zod';
import { AssembledViewArtifactSchema } from '../ui/assembled-views.zod';
import { defineStack } from '../stack.zod';
import type { MetadataType } from './metadata-plugin.zod';

const DECLARATION = { package: 'com.acme.crm', basedOn: '3.2.0' } as const;

/** The issue paths and codes of a failed parse, for a located assertion. */
function issuesOf(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }> } }) {
  return (result.error?.issues ?? []).map((i) => ({ code: i.code, path: i.path.join('.'), keys: i.keys }));
}

describe('OverrideDeclarationSchema — the shape', () => {
  it('accepts { package, basedOn }', () => {
    expect(OverrideDeclarationSchema.parse(DECLARATION)).toEqual(DECLARATION);
  });

  it('accepts a dotted base id and a prerelease basedOn — basedOn is recorded, never judged', () => {
    const d = { package: 'com.example.showcase', basedOn: 'anything a person wrote' };
    expect(OverrideDeclarationSchema.safeParse(d).success).toBe(true);
  });

  it.each([
    ['no package', { basedOn: '3.2.0' }, 'package'],
    ['no basedOn', { package: 'com.acme.crm' }, 'basedOn'],
    ['an empty package', { package: '', basedOn: '3.2.0' }, 'package'],
    ['an empty basedOn', { package: 'com.acme.crm', basedOn: '' }, 'basedOn'],
    ['a non-string basedOn', { package: 'com.acme.crm', basedOn: 3 }, 'basedOn'],
  ])('refuses %s, at that key', (_label, body, key) => {
    const r = OverrideDeclarationSchema.safeParse(body);
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => i.path)).toContain(key);
  });

  it('refuses an unknown key by name — a misspelt key is never dropped', () => {
    const r = OverrideDeclarationSchema.safeParse({ ...DECLARATION, basedon: '3.2.0' });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual(expect.objectContaining({ code: 'unrecognized_keys', keys: ['basedon'] }));
  });

  it(`refuses a \`${CUSTOMIZATION_PACKAGE_SUFFIX}\` package — the declaration names the BASE, never a pair`, () => {
    const r = OverrideDeclarationSchema.safeParse({ package: `com.acme.crm${CUSTOMIZATION_PACKAGE_SUFFIX}`, basedOn: '3.2.0' });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual(expect.objectContaining({ code: 'invalid_format', path: 'package' }));
  });

  it('accepts an id that merely contains the suffix\'s letters', () => {
    for (const id of ['com.acme.customx', 'com.acme.custom-crm', 'custom']) {
      expect(OverrideDeclarationSchema.safeParse({ package: id, basedOn: '1.0.0' }).success, id).toBe(true);
    }
  });

  it('publishes the refusal into the JSON Schema as a pattern (no dropped refinement)', () => {
    const json = z.toJSONSchema(OverrideDeclarationSchema) as unknown as { properties: { package: { pattern?: string } } };
    const pattern = new RegExp(json.properties.package.pattern ?? '');
    expect(pattern.test('com.acme.crm')).toBe(true);
    expect(pattern.test(`com.acme.crm${CUSTOMIZATION_PACKAGE_SUFFIX}`)).toBe(false);
  });

  it('describes basedOn as recorded and never judged (ADR-0146 D2)', () => {
    const described = OverrideDeclarationSchema.shape.basedOn.description ?? '';
    expect(described).toMatch(/Recorded, never judged/);
    expect(OverrideDeclarationFields.overrides.description ?? '').toMatch(/recorded and never judged/);
  });

  it('is NOT part of the ADR-0010 envelope the registration and clone paths strip', () => {
    // `Object.keys(MetadataProtectionFields)` is the set `artifact-collections.ts`
    // and `flow-clone.ts` drop as loader-stamped state. The declaration is authored.
    expect(Object.keys(MetadataProtectionFields)).not.toContain('overrides');
  });
});

// ─────────────────────────────────────────────────────────────────────
// The stored body: the parse the metadata door's save runs
// ─────────────────────────────────────────────────────────────────────

/** Minimal valid bodies for the overridable types with no create seed. */
const EXTRA_FIXTURES: Partial<Record<MetadataType, Record<string, unknown>>> = {
  report: { name: 'sales_by_stage', label: 'Sales by Stage', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'] },
  app: { name: 'crm', label: 'CRM', navigation: [] },
  doc: { name: 'crm_lead_guide', content: '# Lead Guide' },
  book: { name: 'crm_guide', groups: [{ key: 'start', label: 'Start', include: 'crm_*' }] },
};

function fixtureFor(type: MetadataType): Record<string, unknown> {
  const seed = getMetadataCreateSeed(type) as Record<string, unknown> | undefined;
  const body = seed ?? EXTRA_FIXTURES[type];
  if (!body) throw new Error(`no fixture for overridable type '${type}'`);
  return structuredClone(body);
}

/** The flattened list overlay — the package-less overlay row's shape ADR-0146 D11 migrates. */
const LIST_OVERLAY = {
  type: 'grid',
  data: { provider: 'object', object: 'crm_account' },
  columns: ['name'],
  name: 'crm_account.default',
  viewKind: 'list',
  object: 'crm_account',
};

describe('the stored body — every overridable type carries `overrides` through its metadata schema', () => {
  it('the overridable list is the thirteen types ADR-0146 D2 names', () => {
    expect([...OVERRIDABLE_METADATA_TYPES].sort()).toEqual([
      'action', 'app', 'book', 'dashboard', 'dataset', 'doc', 'email_template',
      'flow', 'mapping', 'page', 'report', 'translation', 'view',
    ]);
  });

  it.each(OVERRIDABLE_METADATA_TYPES.map((t) => [t]))('%s keeps `overrides` on parse', (type) => {
    const schema = getMetadataTypeSchema(type)!;
    const body = { ...fixtureFor(type as MetadataType), overrides: { ...DECLARATION } };
    const r = schema.safeParse(body);
    expect(issuesOf(r)).toEqual([]);
    expect((r.data as Record<string, unknown>).overrides).toEqual(DECLARATION);
  });

  it.each(OVERRIDABLE_METADATA_TYPES.map((t) => [t]))('%s refuses a malformed declaration, located under `overrides`', (type) => {
    const schema = getMetadataTypeSchema(type)!;
    const r = schema.safeParse({ ...fixtureFor(type as MetadataType), overrides: { package: 'com.acme.crm' } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('basedOn');
  });

  it('a flattened view overlay (the migrated package-less row) keeps `overrides` too', () => {
    const r = getMetadataTypeSchema('view')!.safeParse({ ...LIST_OVERLAY, overrides: { ...DECLARATION } });
    expect(issuesOf(r)).toEqual([]);
    expect((r.data as Record<string, unknown>).overrides).toEqual(DECLARATION);
  });

  // The types the closed list excludes and that have a create seed: the key is
  // not declared on them, so a body carrying it is refused by name — never
  // silently stored as an override no door honours.
  const excludedWithSeed = (Object.keys(OVERRIDE_TYPE_CLASSIFICATION) as MetadataType[])
    .filter((t) => OVERRIDE_TYPE_CLASSIFICATION[t].disposition !== 'overridable' && getMetadataCreateSeed(t) !== undefined);

  it('measures at least the D6 security type, the extend-only type and a code-only type among them', () => {
    expect(excludedWithSeed).toEqual(expect.arrayContaining(['permission', 'object', 'hook']));
  });

  it.each(excludedWithSeed.map((t) => [t]))('%s (not overridable) refuses `overrides` as an unknown key', (type) => {
    const schema = getMetadataTypeSchema(type)!;
    const r = schema.safeParse({ ...(getMetadataCreateSeed(type) as object), overrides: { ...DECLARATION } });
    expect(r.success).toBe(false);
    expect(issuesOf(r)).toContainEqual(expect.objectContaining({ code: 'unrecognized_keys', keys: ['overrides'] }));
  });
});

// ─────────────────────────────────────────────────────────────────────
// defineStack() and the export's view channel
// ─────────────────────────────────────────────────────────────────────

describe('`overrides` survives defineStack()', () => {
  // Strict (the default): every collection is parsed by its item schema and
  // the cross-reference checks run, so the key is judged, not skipped.
  const OBJ = 'crm_custom_ticket';
  const o = () => ({ ...DECLARATION });
  const stack = defineStack({
    manifest: { id: 'com.acme.crm.custom', name: 'crm_custom', version: '1.0.0', type: 'app', namespace: 'crm_custom' },
    objects: [{ name: OBJ, label: 'Ticket', fields: { subject: { type: 'text', label: 'Subject' } } }],
    apps: [{ ...EXTRA_FIXTURES.app!, overrides: o() }],
    pages: [{ ...fixtureFor('page'), object: OBJ, overrides: o() }],
    dashboards: [{ ...fixtureFor('dashboard'), overrides: o() }],
    datasets: [{ ...fixtureFor('dataset'), name: 'tickets', object: OBJ, overrides: o() }],
    reports: [{ name: 'tickets_by_subject', label: 'Tickets', type: 'summary', dataset: 'tickets', rows: ['subject'], values: ['count'], overrides: o() }],
    actions: [{ ...fixtureFor('action'), overrides: o() }],
    flows: [{ ...fixtureFor('flow'), overrides: o() }],
    emailTemplates: [{ ...fixtureFor('email_template'), overrides: o() }],
    docs: [{ ...EXTRA_FIXTURES.doc!, overrides: o() }],
    books: [{ ...EXTRA_FIXTURES.book!, overrides: o() }],
    mappings: [{ ...fixtureFor('mapping'), targetObject: OBJ, fieldMapping: [{ source: 'Subject', target: 'subject' }], overrides: o() }],
  } as never) as unknown as Record<string, Array<Record<string, unknown>>>;

  it.each([
    'apps', 'pages', 'dashboards', 'reports', 'datasets', 'actions', 'flows', 'emailTemplates', 'docs', 'books', 'mappings',
  ])('stack.%s[0].overrides is the declaration as written', (collection) => {
    expect(stack[collection]?.[0]?.overrides).toEqual(DECLARATION);
  });

  it('a malformed declaration is refused by the strict build, not carried', () => {
    expect(() => defineStack({
      manifest: { id: 'com.acme.crm.custom', name: 'crm_custom', version: '1.0.0', type: 'app', namespace: 'crm_custom' },
      flows: [{ ...fixtureFor('flow'), overrides: { package: 'com.acme.crm' } }],
    } as never)).toThrow(/basedOn/);
  });
});

describe('`overrides` survives the export\'s view channel (`viewItems:`)', () => {
  it.each([
    ['a standalone ViewItem', () => fixtureFor('view')],
    ['a flattened list overlay', () => structuredClone(LIST_OVERLAY)],
  ])('%s keeps `overrides` through AssembledViewArtifactSchema', (_label, body) => {
    const r = AssembledViewArtifactSchema.safeParse({ ...body(), overrides: { ...DECLARATION } });
    expect(issuesOf(r)).toEqual([]);
    expect((r.data as Record<string, unknown>).overrides).toEqual(DECLARATION);
  });
});
