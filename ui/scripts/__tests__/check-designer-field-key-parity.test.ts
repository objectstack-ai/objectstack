import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
// The permission oracles are NOT on `/data` (objectui#6606) — the identity
// proof below has to import them from the subpath the gate reads them from.
import { ObjectPermissionSchema, PermissionSetSchema } from '@objectstack/spec/security';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  ExtractionError,
  KNOWN_UNPARSEABLE_KEYS,
  ORACLES,
  ORACLE_SPECIFIERS,
  PAYLOAD_SHAPES,
  RETIRED_KEY_REGISTRY_FILE,
  SITES_WITH_NO_DECLARED_SHAPE,
  analyze,
  declaredKeys,
  fieldSchemaAcceptSet,
  objectSchemaAcceptSet,
  readRetiredKeyRegistry,
  schemaAcceptSet,
} from '../check-designer-field-key-parity.mjs';

/**
 * objectui#5761. The gate this file tests compares the keys a field designer's
 * statically declared payload shapes can emit against the keys the INSTALLED
 * `FieldSchema` accepts. Its whole value is that it goes red on a key the spec
 * refuses by name — and a parity check is the one gate shape that can be
 * catastrophically, invisibly vacuous:
 *
 *   - resolve the wrong symbol (a local structural look-alike rather than the
 *     spec's schema) and everything passes;
 *   - resolve a LOOSENED schema (non-strict zod object, `.passthrough()`) and
 *     everything passes;
 *   - fail to find the interface in a renamed file and, without the throw,
 *     "zero declared keys" reads as "zero bad keys".
 *
 * All three produce a confident green over a broken instrument. So this file
 * carries the negative controls as EXECUTABLE assertions rather than as prose,
 * exactly as the card required: an un-stripped `indexed` must be reported with
 * `unrecognized_keys`, a bogus key must be reported, and the resolved schema
 * must be provably the installed `@objectstack/spec` one.
 */

const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, '..', '..');

/** One fixture tombstone. `key`/`retiredBy` are optional so the malformed cases can omit them. */
type FixtureTombstone = { key?: string; retiredBy?: string; sites: Record<string, boolean> };

/**
 * A synthetic registry source, in the shape `readRetiredKeyRegistry` walks
 * (`as const satisfies …` and all). Fixture registries name sites from the REAL
 * site vocabulary, because the gate's site-coverage check is a statement about
 * the gate's own declared surface rather than about the fixture tree.
 */
function registrySource(sites: string[], tombstones: FixtureTombstone[]): string {
  const entries = tombstones.map((t) => {
    const columns = Object.entries(t.sites)
      .map(([site, on]) => `      ${site}: ${on},`)
      .join('\n');
    return [
      '  {',
      t.key === undefined ? '' : `    key: '${t.key}',\n`,
      t.retiredBy === undefined ? '' : `    retiredBy: '${t.retiredBy}',\n`,
      '    sites: {\n',
      `${columns}\n`,
      '    },\n',
      '  }',
    ].join('');
  });
  return [
    `export const RETIRED_FIELD_KEY_SITES = [\n${sites.map((s) => `  '${s}',`).join('\n')}\n] as const;\n`,
    `\nexport const RETIRED_FIELD_KEY_TOMBSTONES = [\n${entries.join(',\n')},\n] as const satisfies readonly unknown[];\n`,
  ].join('');
}

/**
 * The registry every fixture tree gets unless it writes its own.
 *
 * The gate now REQUIRES a registry to run (objectui#6699 — an unreadable one is
 * an ExtractionError, never a pass), so a fixture tree has to carry one. This
 * default is deliberately inert: its one tombstone names a key no fixture shape
 * declares, at the one site that has no payload shape, so it cannot change any
 * verdict the other cases in this file measure.
 */
const DEFAULT_FIXTURE_REGISTRY = registrySource(
  ['metadataAdminFieldsReadDoor'],
  [{ key: 'zzzFixtureRetiredKey', retiredBy: 'objectui#0000', sites: { metadataAdminFieldsReadDoor: true } }],
);

/**
 * Writes fixture sources to a throwaway dir and runs the REAL extractor over them.
 *
 * `options.registry` overrides the default registry source; `null` writes none
 * at all, which is how the missing-registry extraction failure is probed.
 */
async function withFixture<T>(
  files: Record<string, string>,
  run: (dir: string) => Promise<T>,
  options: { registry?: string | null } = {},
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-field-parity-'));
  const registry = options.registry === undefined ? DEFAULT_FIXTURE_REGISTRY : options.registry;
  const withRegistry =
    registry === null ? files : { [RETIRED_KEY_REGISTRY_FILE]: registry, ...files };
  try {
    for (const [name, contents] of Object.entries(withRegistry)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const WIRE_SHAPE = {
  id: 'FixturePayload',
  file: 'payload.ts',
  interface: 'FixturePayload',
  reach: 'wire' as const,
  writer: 'fixture',
};

const fixtureShape = (body: string) => ({
  files: { 'payload.ts': `export interface FixturePayload {\n${body}\n}\n` },
  shapes: [WIRE_SHAPE],
});

describe('the instrument is the installed FieldSchema, not a look-alike', () => {
  it('resolves the very same schema object `@objectstack/spec/data` exports', async () => {
    // Reference identity, not a structural comparison. The card measured that
    // `packages/plugin-designer` declares its own `ServerFieldSchema` subset
    // type — a look-alike that is one of this gate's INPUTS and must never be
    // mistaken for its oracle. A structural check could not tell them apart;
    // `===` can.
    //
    // This assertion is also what keeps the gate on the ESM build. It failed
    // when the gate resolved the spec through `createRequire`: `@objectstack/spec`
    // is dual-package, so `require` and `import` hand back two different module
    // instances of the same schema, and the gate was reading a build the app
    // never bundles. Structural equality would have been green for that.
    const { schema } = await fieldSchemaAcceptSet();
    expect(schema).toBe(FieldSchema);
  });

  it('reads the accept set off the schema itself, and it is a real subset of all strings', async () => {
    const { accept } = await fieldSchemaAcceptSet();
    // Non-vacuity in the other direction: a schema that accepted everything
    // would make every parity comparison trivially green.
    expect(accept.has('label')).toBe(true);
    expect(accept.has('placeholder')).toBe(true);
    expect(accept.has('indexed')).toBe(false);
    expect(accept.has('zzzDefinitelyNotAKey')).toBe(false);
    expect(accept.size).toBeGreaterThan(20);
  });

  it('is a STRICT schema — it refuses unknown keys rather than stripping them', async () => {
    // If `FieldSchema` ever became non-strict this gate would still be green
    // while the thing it guards stopped being true, so pin the behaviour that
    // makes key-level parity meaningful at all (objectstack#4001 closed the
    // silent-drop shape).
    const stripped = FieldSchema.safeParse({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(stripped.success).toBe(false);
    expect(stripped.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });
});

describe('negative controls — the gate must go red on a refused key', () => {
  it('reports an un-stripped `indexed`, the objectui#4644 instance', async () => {
    const { files, shapes } = fixtureShape('  type?: string;\n  label?: string;\n  indexed?: boolean;');
    await withFixture(files, async (dir) => {
      const { violations } = await analyze(dir, { shapes, ledger: {} });
      expect(violations.map((v) => v.key)).toEqual(['indexed']);
    });
  });

  it('the same payload really is what the spec refuses, with `unrecognized_keys`', async () => {
    // The control above proves the GATE reports the key. This one proves the
    // key is genuinely refused by the real schema — otherwise the gate could be
    // red about something harmless.
    const parsed = FieldSchema.safeParse({ type: 'text', label: 'L', indexed: true });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect((issue as { keys: string[] }).keys).toContain('indexed');
  });

  it('reports a bogus key', async () => {
    const { files, shapes } = fixtureShape('  label?: string;\n  zzzDefinitelyNotAKey?: string;');
    await withFixture(files, async (dir) => {
      const { violations } = await analyze(dir, { shapes, ledger: {} });
      expect(violations.map((v) => v.key)).toEqual(['zzzDefinitelyNotAKey']);
    });
  });

  it('stays green on a shape whose every key the spec accepts', async () => {
    const { files, shapes } = fixtureShape('  type?: string;\n  label?: string;\n  placeholder?: string;');
    await withFixture(files, async (dir) => {
      expect((await analyze(dir, { shapes, ledger: {} })).violations).toEqual([]);
    });
  });
});

describe('reach classification — a UI-only key is not a wire violation', () => {
  const UI_SHAPE = { id: 'FixtureUi', file: 'ui.ts', interface: 'FixtureUi', reach: 'ui' as const, writer: 'fixture' };

  it('a refused key declared only on the UI model is reported as uiOnly, not as a violation', async () => {
    await withFixture(
      {
        'payload.ts': 'export interface FixturePayload {\n  label?: string;\n}\n',
        'ui.ts': 'export interface FixtureUi {\n  label?: string;\n  zzzUiOnlyKey?: string;\n}\n',
      },
      async (dir) => {
        const { violations, uiOnly } = await analyze(dir, { shapes: [WIRE_SHAPE, UI_SHAPE], ledger: {} });
        expect(violations).toEqual([]);
        expect(uiOnly.map((u) => u.key)).toEqual(['zzzUiOnlyKey']);
      },
    );
  });

  it('the SAME key becomes a violation the moment a wire shape declares it too', async () => {
    // This is what makes the uiOnly bucket safe to have: it is recomputed every
    // run from the wire shapes, never asserted once and trusted.
    await withFixture(
      {
        'payload.ts': 'export interface FixturePayload {\n  label?: string;\n  zzzUiOnlyKey?: string;\n}\n',
        'ui.ts': 'export interface FixtureUi {\n  label?: string;\n  zzzUiOnlyKey?: string;\n}\n',
      },
      async (dir) => {
        const { violations, uiOnly } = await analyze(dir, { shapes: [WIRE_SHAPE, UI_SHAPE], ledger: {} });
        expect(uiOnly).toEqual([]);
        expect(violations.map((v) => `${v.shape}.${v.key}`)).toEqual([
          'FixturePayload.zzzUiOnlyKey',
          'FixtureUi.zzzUiOnlyKey',
        ]);
      },
    );
  });
});

describe('the second oracle — objectui#6223', () => {
  const OBJECT_WIRE = {
    id: 'FixtureObjectPayload',
    file: 'object-payload.ts',
    interface: 'FixtureObjectPayload',
    schema: 'ObjectSchema' as const,
    reach: 'wire' as const,
    writer: 'fixture',
  };
  const OBJECT_UI = {
    id: 'FixtureObjectUi',
    file: 'object-ui.ts',
    interface: 'FixtureObjectUi',
    schema: 'ObjectSchema' as const,
    reach: 'ui' as const,
    writer: 'fixture',
  };

  it('resolves the very same `ObjectSchema` object `@objectstack/spec/data` exports', async () => {
    // Reference identity, exactly as for the field oracle: `plugin-designer`
    // declares its own `ServerObjectSchema` subset type, which is one of this
    // gate's INPUTS and must never be mistaken for its oracle. A structural
    // check could not tell the two apart; `===` can. This also keeps the second
    // oracle on the ESM build for the same dual-package reason.
    const { schema } = await objectSchemaAcceptSet();
    expect(schema).toBe(ObjectSchema);
  });

  it('reads an object accept set that is REAL and DIFFERENT from the field one', async () => {
    // If the two oracles ever resolved to the same schema the object-level
    // check would be vacuous while looking like it ran, so the difference is
    // asserted rather than assumed.
    const { accept: objectKeys } = await objectSchemaAcceptSet();
    const { accept: fieldKeys } = await fieldSchemaAcceptSet();
    expect(objectKeys.has('fields')).toBe(true);
    expect(objectKeys.has('isSystem')).toBe(true);
    expect(objectKeys.has('group')).toBe(false);
    expect(objectKeys.has('zzzDefinitelyNotAKey')).toBe(false);
    expect(objectKeys.size).toBeGreaterThan(20);
    expect(objectKeys.size).not.toBe(fieldKeys.size);
  });

  it('is STRICT — an object document refuses unknown keys rather than stripping them', () => {
    const base = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };
    const stripped = ObjectSchema.safeParse({ ...base, zzzDefinitelyNotAKey: 1 });
    expect(stripped.success).toBe(false);
    expect(stripped.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('goes red on an object-level key the OBJECT schema refuses', async () => {
    // The objectui#6223 instance, as a negative control: `group` on an
    // object-level wire shape.
    await withFixture(
      { 'object-payload.ts': 'export interface FixtureObjectPayload {\n  name?: string;\n  label?: string;\n  group?: string;\n}\n' },
      async (dir) => {
        const { violations } = await analyze(dir, { shapes: [OBJECT_WIRE], ledger: {} });
        expect(violations.map((v) => `${v.key}:${v.oracle}`)).toEqual(['group:ObjectSchema']);
      },
    );
  });

  it('the same key really is refused by the real ObjectSchema, with `unrecognized_keys`', async () => {
    // The control above proves the GATE reports it. This one proves the key is
    // genuinely refused, so the gate is not red about something harmless.
    const parsed = ObjectSchema.safeParse({
      name: 'account',
      label: 'Account',
      fields: { n: { type: 'text', label: 'N' } },
      group: 'Sales',
    });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys: string[] }).keys).toContain('group');
  });

  it('routes each shape to ITS OWN oracle — `group` is legal on a field and refused on an object', async () => {
    // The one assertion that a single pooled accept set could not satisfy, and
    // the reason the second oracle is a per-shape property rather than a union.
    // `FieldSchema` accepts `group`; `ObjectSchema` does not. A gate that
    // checked every shape against a merged set would have stayed green on
    // exactly the three keys objectui#6223 found.
    expect(FieldSchema.safeParse({ type: 'text', label: 'L', group: 'Details' }).success).toBe(true);
    await withFixture(
      {
        'payload.ts': 'export interface FixturePayload {\n  type?: string;\n  label?: string;\n  group?: string;\n}\n',
        'object-payload.ts': 'export interface FixtureObjectPayload {\n  name?: string;\n  label?: string;\n  group?: string;\n}\n',
      },
      async (dir) => {
        const { violations } = await analyze(dir, { shapes: [WIRE_SHAPE, OBJECT_WIRE], ledger: {} });
        expect(violations.map((v) => `${v.shape}.${v.key}`)).toEqual(['FixtureObjectPayload.group']);
      },
    );
  });

  it('resolves REACH within an oracle, never across one', async () => {
    // `group` on an object UI model is uiOnly — but only because no OBJECT wire
    // shape declares it. A field wire shape declaring the same spelling must
    // not launder it into a violation, nor a violation into a uiOnly.
    await withFixture(
      {
        'payload.ts': 'export interface FixturePayload {\n  type?: string;\n  label?: string;\n  group?: string;\n}\n',
        'object-ui.ts': 'export interface FixtureObjectUi {\n  name?: string;\n  label?: string;\n  group?: string;\n}\n',
      },
      async (dir) => {
        const { violations, uiOnly } = await analyze(dir, { shapes: [WIRE_SHAPE, OBJECT_UI], ledger: {} });
        expect(violations).toEqual([]);
        expect(uiOnly.map((u) => `${u.shape}.${u.key}`)).toEqual(['FixtureObjectUi.group']);
      },
    );
  });

  it('and the object UI key becomes a violation the moment an object WIRE shape declares it', async () => {
    await withFixture(
      {
        'object-payload.ts': 'export interface FixtureObjectPayload {\n  name?: string;\n  label?: string;\n  group?: string;\n}\n',
        'object-ui.ts': 'export interface FixtureObjectUi {\n  name?: string;\n  label?: string;\n  group?: string;\n}\n',
      },
      async (dir) => {
        const { violations, uiOnly } = await analyze(dir, { shapes: [OBJECT_WIRE, OBJECT_UI], ledger: {} });
        expect(uiOnly).toEqual([]);
        expect(violations.map((v) => `${v.shape}.${v.key}`)).toEqual([
          'FixtureObjectPayload.group',
          'FixtureObjectUi.group',
        ]);
      },
    );
  });

  it('scopes a ledger entry to ITS oracle — one level\'s card must not absorb the other level\'s key', async () => {
    // Measured during objectui#6223's ablation, which is why it is pinned here.
    // `sortOrder` is refused at BOTH levels by two different schemas and is two
    // different cards (objectui#6045 field-level, objectui#6223 object-level).
    // With a name-keyed ledger, re-declaring the OBJECT-level key stayed green:
    // the field-level card's entry absorbed it in silence. That is the ledger
    // becoming a hiding place, which the header says it must never be.
    const FIELD_LEDGER = {
      zzzTwoLevelKey: { card: 'objectui#0000', oracle: 'FieldSchema', spec: null, note: 'fixture' },
    };
    await withFixture(
      {
        'payload.ts': 'export interface FixturePayload {\n  type?: string;\n  label?: string;\n  zzzTwoLevelKey?: string;\n}\n',
        'object-payload.ts': 'export interface FixtureObjectPayload {\n  name?: string;\n  label?: string;\n  zzzTwoLevelKey?: string;\n}\n',
      },
      async (dir) => {
        const { violations, staleLedger } = await analyze(dir, {
          shapes: [WIRE_SHAPE, OBJECT_WIRE],
          ledger: FIELD_LEDGER,
        });
        // The field-level occurrence is covered by its card...
        expect(staleLedger).toEqual([]);
        // ...and the object-level one is NOT, because the entry is not scoped to
        // that oracle. Exactly one violation, on the object shape.
        expect(violations.map((v) => `${v.shape}.${v.key}`)).toEqual([
          'FixtureObjectPayload.zzzTwoLevelKey',
        ]);
      },
    );
  });

  it('an entry scoped to an oracle no shape of that oracle declares is stale', async () => {
    // The other direction of the same scope. An ObjectSchema-scoped entry is
    // not kept alive by a FIELD shape that happens to declare the same
    // spelling, or the entry would outlive the refusal it was filed for.
    await withFixture(
      { 'payload.ts': 'export interface FixturePayload {\n  type?: string;\n  label?: string;\n  zzzTwoLevelKey?: string;\n}\n' },
      async (dir) => {
        const { staleLedger } = await analyze(dir, {
          shapes: [WIRE_SHAPE],
          ledger: {
            zzzTwoLevelKey: { card: 'objectui#0000', oracle: 'ObjectSchema', spec: null, note: 'fixture' },
          },
        });
        expect(staleLedger).toEqual([
          { key: 'zzzTwoLevelKey', reason: 'no payload shape declares it any more' },
        ]);
      },
    );
  });

  it('throws when the object oracle cannot be resolved — a missing schema is never a pass', async () => {
    await expect(
      analyze(repoRoot, {
        shapes: [OBJECT_WIRE],
        ledger: {},
        importSpec: async () => ({ FieldSchema }),
      }),
    ).rejects.toThrow(/no longer exports `ObjectSchema`/);
  });
});

describe('the permission oracles — objectui#6606', () => {
  // The permission matrix is the SECOND authoring surface with both of this
  // gate's ingredients, and it was in none of the six original shapes.
  // objectui#6595 (retired `allowRestore` / `allowPurge` checkboxes) is an
  // instance of exactly this gate's class that reached the repo as a
  // hand-written card rather than as a red gate.
  const PERM_ROW_WIRE = {
    id: 'FixturePermRow',
    file: 'perm-row.ts',
    interface: 'FixturePermRow',
    schema: 'ObjectPermissionSchema' as const,
    reach: 'wire' as const,
    writer: 'fixture',
  };
  const PERM_SET_WIRE = {
    id: 'FixturePermSet',
    file: 'perm-set.ts',
    interface: 'FixturePermSet',
    schema: 'PermissionSetSchema' as const,
    reach: 'wire' as const,
    writer: 'fixture',
  };

  it('resolves the very same schema objects `@objectstack/spec/security` exports', async () => {
    // Reference identity, as for the other two oracles: a structural check
    // could not tell the installed schema from a look-alike, `===` can, and it
    // is also what pins these to the ESM build for the dual-package reason.
    expect((await schemaAcceptSet('ObjectPermissionSchema')).schema).toBe(ObjectPermissionSchema);
    expect((await schemaAcceptSet('PermissionSetSchema')).schema).toBe(PermissionSetSchema);
  });

  it('reads them from `/security`, because `/data` does not export them', async () => {
    // The subpath decides WHICH MODULE judges a save, so the measurement the
    // map records is asserted rather than trusted. If these ever move onto
    // `/data`, `ORACLE_SPECIFIERS` has to move with them and this fails first.
    const data = await import('@objectstack/spec/data');
    expect(data).not.toHaveProperty('ObjectPermissionSchema');
    expect(data).not.toHaveProperty('PermissionSetSchema');
    expect(ORACLE_SPECIFIERS.ObjectPermissionSchema).toBe('@objectstack/spec/security');
    expect(ORACLE_SPECIFIERS.PermissionSetSchema).toBe('@objectstack/spec/security');
  });

  it('reads accept sets that are REAL and DIFFERENT from each other', async () => {
    // Two oracles that resolved to the same schema would make one of the two
    // checks vacuous while looking like it ran.
    const { accept: rowKeys } = await schemaAcceptSet('ObjectPermissionSchema');
    const { accept: setKeys } = await schemaAcceptSet('PermissionSetSchema');
    const { accept: fieldKeys } = await fieldSchemaAcceptSet();
    expect(rowKeys.has('allowRead')).toBe(true);
    expect(rowKeys.has('objects')).toBe(false);
    expect(setKeys.has('objects')).toBe(true);
    expect(setKeys.has('allowRead')).toBe(false);
    expect(rowKeys.has('zzzDefinitelyNotAKey')).toBe(false);
    expect(rowKeys.size).not.toBe(setKeys.size);
    expect(setKeys.size).not.toBe(fieldKeys.size);
  });

  it('both are STRICT — an unknown key is refused, not stripped', () => {
    const row = ObjectPermissionSchema.safeParse({ allowRead: true, zzzDefinitelyNotAKey: 1 });
    expect(row.success).toBe(false);
    expect(row.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    const set = PermissionSetSchema.safeParse({ name: 'admin', objects: {}, zzzDefinitelyNotAKey: 1 });
    expect(set.success).toBe(false);
    expect(set.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    // The same body without the extra key parses, so the failure above is the
    // unknown key and not an unrelated invalid base.
    expect(PermissionSetSchema.safeParse({ name: 'admin', objects: {} }).success).toBe(true);
  });

  it('goes red on a field-permission key sitting on an object-permission row', async () => {
    // Realistic rather than bogus: `readable` / `editable` are the `FieldPerm`
    // facets one level over, and an object row refuses them by name.
    await withFixture(
      { 'perm-row.ts': 'export interface FixturePermRow {\n  allowRead?: boolean;\n  readable?: boolean;\n}\n' },
      async (dir) => {
        const { violations } = await analyze(dir, { shapes: [PERM_ROW_WIRE], ledger: {} });
        expect(violations.map((v) => `${v.key}:${v.oracle}`)).toEqual(['readable:ObjectPermissionSchema']);
      },
    );
  });

  it('the same key really is refused by the real schema, with `unrecognized_keys`', () => {
    const parsed = ObjectPermissionSchema.safeParse({ allowRead: true, readable: true });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys: string[] }).keys).toContain('readable');
  });

  it('routes each shape to ITS OWN oracle — `objects` is legal on the record and refused on a row', async () => {
    // The record/row pair is the same trap the field/object pair carries:
    // a pooled accept set would let a row-level key hide behind the record
    // shape that legitimately declares that spelling.
    await withFixture(
      {
        'perm-set.ts': 'export interface FixturePermSet {\n  name?: string;\n  objects?: unknown;\n}\n',
        'perm-row.ts': 'export interface FixturePermRow {\n  allowRead?: boolean;\n  objects?: unknown;\n}\n',
      },
      async (dir) => {
        const { violations } = await analyze(dir, {
          shapes: [PERM_SET_WIRE, PERM_ROW_WIRE],
          ledger: {},
        });
        expect(violations.map((v) => `${v.key}:${v.oracle}`)).toEqual(['objects:ObjectPermissionSchema']);
      },
    );
  });

  it('throws when a permission oracle cannot be resolved — a missing schema is never a pass', async () => {
    await expect(
      analyze(repoRoot, { shapes: [PERM_ROW_WIRE], ledger: {}, importSpec: async () => ({}) }),
    ).rejects.toThrow(/no longer exports `ObjectPermissionSchema`/);
  });

  it('throws when a shape names an oracle no subpath is declared for', async () => {
    // The failure mode the per-oracle subpath map introduces. Defaulting an
    // unknown oracle to `/data` would resolve the wrong module — or nothing —
    // and hand back the confident green this file exists to prevent.
    const unmapped = { ...PERM_ROW_WIRE, schema: 'NotAnOracleSchema' as const };
    await expect(analyze(repoRoot, { shapes: [unmapped], ledger: {} })).rejects.toThrow(ExtractionError);
    await expect(analyze(repoRoot, { shapes: [unmapped], ledger: {} })).rejects.toThrow(
      /no spec subpath is declared for the oracle `NotAnOracleSchema`/,
    );
  });

  it('carries both permission shapes on the real tree, each judged by its own oracle', () => {
    const perm = PAYLOAD_SHAPES.filter((s) => s.file.endsWith('permission-slice.ts'));
    expect(perm.map((s) => `${s.id}:${s.schema}:${s.reach}`).sort()).toEqual([
      'ObjectPerm:ObjectPermissionSchema:wire',
      'PermissionSetDraft:PermissionSetSchema:wire',
    ]);
  });

  it('sees the index signature on `PermissionSetDraft` — coverage note 2 applies here too', () => {
    // `[extra: string]: unknown` is this shape's stated contract (a key the
    // editor does not model is carried through save untouched), which is
    // precisely the hole the gate records rather than hides.
    const draft = PAYLOAD_SHAPES.find((s) => s.id === 'PermissionSetDraft')!;
    expect(declaredKeys(repoRoot, draft).indexSignature).toBe(true);
  });

  it('every key the permission shapes can EMIT is accepted, on the real tree', async () => {
    for (const id of ['PermissionSetDraft', 'ObjectPerm']) {
      const shape = PAYLOAD_SHAPES.find((s) => s.id === id)!;
      const { accept } = await schemaAcceptSet(shape.schema);
      const { keys } = declaredKeys(repoRoot, shape);
      expect(keys.filter((k: string) => !accept.has(k)), `${id} emits a refused key`).toEqual([]);
    }
  });

  it('stays EMIT-SIDE — a spec key the shape omits is not reported', async () => {
    // objectui#6605: `ObjectPerm` is a hand-written SUBSET of the spec's
    // `ObjectPermission`. Under-coverage is a different question from the one
    // this gate answers and stays a separate card, so the gate must be silent
    // about the omissions. If that charter ever widens, this is the assertion
    // that has to argue for it rather than be quietly deleted.
    const { accept } = await schemaAcceptSet('ObjectPermissionSchema');
    const shape = PAYLOAD_SHAPES.find((s) => s.id === 'ObjectPerm')!;
    const { keys } = declaredKeys(repoRoot, shape);
    const omitted = [...accept].filter((k) => !keys.includes(k));
    expect(omitted).toContain('allowExport');
    const { violations, uiOnly } = await analyze(repoRoot);
    for (const key of omitted) {
      expect(violations.map((v) => v.key), `${key} reported as a violation`).not.toContain(key);
      expect(uiOnly.map((u) => u.key), `${key} reported as uiOnly`).not.toContain(key);
    }
  });
});

describe('the ledger ratchets in both directions', () => {
  const LEDGER = { zzzLedgeredKey: { card: 'objectui#0000', spec: null, note: 'fixture' } };

  it('a ledgered key is not a violation', async () => {
    const { files, shapes } = fixtureShape('  label?: string;\n  zzzLedgeredKey?: string;');
    await withFixture(files, async (dir) => {
      const { violations, staleLedger } = await analyze(dir, { shapes, ledger: LEDGER });
      expect(violations).toEqual([]);
      expect(staleLedger).toEqual([]);
    });
  });

  it('an entry whose key no shape declares any more is itself red', async () => {
    // Without this half the ledger becomes a place to hide: a key gets fixed,
    // the entry survives, and the same spelling is silently re-admitted the
    // next time someone declares it.
    const { files, shapes } = fixtureShape('  label?: string;');
    await withFixture(files, async (dir) => {
      const { staleLedger } = await analyze(dir, { shapes, ledger: LEDGER });
      expect(staleLedger).toEqual([
        { key: 'zzzLedgeredKey', reason: 'no payload shape declares it any more' },
      ]);
    });
  });

  it('an entry whose key the spec now accepts is red, naming that reason', async () => {
    // The objectui#4676 resolution shape: `placeholder` was refused, the
    // producer moved upstream, and the spec started accepting it. The entry
    // must not outlive the refusal.
    const { files, shapes } = fixtureShape('  label?: string;\n  placeholder?: string;');
    await withFixture(files, async (dir) => {
      const { staleLedger } = await analyze(dir, {
        shapes,
        ledger: { placeholder: { card: 'objectui#4676', spec: null, note: 'fixture' } },
      });
      expect(staleLedger).toEqual([{ key: 'placeholder', reason: '`FieldSchema` now accepts it' }]);
    });
  });
});

describe('the tombstone registry is the single source for retirement — objectui#6699', () => {
  // objectui#6527 converged three drifted per-site retired-key literals into
  // one registry. A registry with no gate pinning it is a convention, so this
  // block is the mechanical half: the gate READS it, and the per-site asymmetry
  // the registry deliberately encodes survives every step of that read.
  //
  // The registry file and the three strip sites are NOT edited by these cases:
  // the fixtures either synthesise a registry or copy the real one into a
  // throwaway tree, so the ablation never touches a shipped strip site.

  /** The real registry's own source, copied into fixture trees verbatim. */
  const REAL_REGISTRY = fs.readFileSync(path.join(repoRoot, RETIRED_KEY_REGISTRY_FILE), 'utf8');

  /** A fixture wire shape that IS one of the registry's strip sites. */
  const atSite = (stripSite: string) => ({ ...WIRE_SHAPE, id: `Fixture@${stripSite}`, stripSite });

  const fieldRow = { card: 'objectui#0000', oracle: 'FieldSchema', spec: null, note: 'fixture' };
  const declaring = (key: string) =>
    `export interface FixturePayload {\n  type?: string;\n  label?: string;\n  ${key}?: string;\n}\n`;

  describe('extraction — a registry this gate cannot read is never a pass', () => {
    it('reads every tombstone key and every site NAME off the real registry', () => {
      // The non-vacuity floor. A walk that silently returned nothing would make
      // every retirement rule below trivially satisfied while reading green —
      // "nothing is retired" is exactly the drift objectui#6527 closed.
      const registry = readRetiredKeyRegistry(repoRoot);
      expect(registry.file).toBe(RETIRED_KEY_REGISTRY_FILE);
      // Sites EXACTLY: the gate's coverage of them is exact by construction (a
      // site accounted for nowhere is an ExtractionError), so this is the same
      // statement, said where a reader will see it.
      expect(registry.sites).toEqual([
        'metadataAdminFieldsReadDoor',
        'metadataServiceCarryOver',
        'metadataFieldsPageCarryOver',
      ]);
      // Keys as a FLOOR rather than a census — the census is the registry's own
      // test's to keep; what must not happen here is a key going missing.
      const keys = registry.tombstones.map((t) => t.key);
      expect(keys).toEqual(
        expect.arrayContaining(['indexed', 'referenceTo', 'formula', 'isSystem', 'sortOrder']),
      );
      // Control terms: a walk that scooped up every string literal, or every
      // property name, would pass the floor above and fail here.
      expect(keys).not.toContain('label');
      expect(keys).not.toContain('specEquivalent');
      expect(registry.sites).not.toContain('zzzNotASite');
      for (const t of registry.tombstones) expect(t.retiredBy).toMatch(/^objectui#\d+$/);
    });

    it('throws when the registry file is gone', async () => {
      await withFixture(
        { 'payload.ts': 'export interface FixturePayload {\n  label?: string;\n}\n' },
        async (dir) => {
          await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(
            /retired-field-key registry .* does not exist/,
          );
        },
        { registry: null },
      );
    });

    it('throws when the tombstone constant is gone — an empty read is not "nothing is retired"', async () => {
      await withFixture(
        { 'payload.ts': 'export interface FixturePayload {\n  label?: string;\n}\n' },
        async (dir) => {
          await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(
            /`RETIRED_FIELD_KEY_TOMBSTONES` is not an array literal/,
          );
        },
        { registry: "export const RETIRED_FIELD_KEY_SITES = ['metadataAdminFieldsReadDoor'] as const;\n" },
      );
    });

    it('throws on a tombstone with no `key` — a nameless tombstone retires nothing', async () => {
      await withFixture(
        { 'payload.ts': 'export interface FixturePayload {\n  label?: string;\n}\n' },
        async (dir) => {
          await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(
            /declares no string `key`/,
          );
        },
        {
          registry: registrySource(
            ['metadataAdminFieldsReadDoor'],
            [{ retiredBy: 'objectui#0000', sites: { metadataAdminFieldsReadDoor: true } }],
          ),
        },
      );
    });

    it('throws when a `sites` record names a site the registry does not declare', async () => {
      // The two halves of the registry drifting apart. Reading past it would
      // evaluate a retirement against a site that does not exist — a column
      // that can never be `true`, i.e. a silently disabled rule.
      await withFixture(
        { 'payload.ts': 'export interface FixturePayload {\n  label?: string;\n}\n' },
        async (dir) => {
          await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(
            /names the site `zzzGhostSite`, which `RETIRED_FIELD_KEY_SITES` does not declare/,
          );
        },
        {
          registry: registrySource(
            ['metadataAdminFieldsReadDoor'],
            [
              {
                key: 'zzzGhostSited',
                retiredBy: 'objectui#0000',
                sites: { metadataAdminFieldsReadDoor: true, zzzGhostSite: true },
              },
            ],
          ),
        },
      );
    });

    it('⭐ throws when the registry grows a site this gate accounts for nowhere', async () => {
      // This is what makes the registry the single SOURCE rather than a single
      // copy: it cannot gain a strip site while the gate goes on judging only
      // the sites it already knew, in silence.
      await withFixture(
        { 'payload.ts': 'export interface FixturePayload {\n  label?: string;\n}\n' },
        async (dir) => {
          await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(
            /declares strip site\(s\) `zzzUnadjudicatedSite` this gate accounts for nowhere/,
          );
        },
        {
          registry: registrySource(
            ['metadataServiceCarryOver', 'zzzUnadjudicatedSite'],
            [
              {
                key: 'zzzSomeKey',
                retiredBy: 'objectui#0000',
                sites: { metadataServiceCarryOver: true, zzzUnadjudicatedSite: true },
              },
            ],
          ),
        },
      );
    });

    it('throws when a shape names a strip site the registry does not declare', async () => {
      // The other direction of the same link: a renamed site must not leave a
      // shape quietly enforcing nothing.
      await withFixture(
        { 'payload.ts': declaring('indexed') },
        async (dir) => {
          await expect(
            analyze(dir, { shapes: [atSite('metadataFieldsPageCarryOver')], ledger: {} }),
          ).rejects.toThrow(/names the strip site `metadataFieldsPageCarryOver`, which .* does not declare/);
        },
        {
          registry: registrySource(
            ['metadataServiceCarryOver'],
            [{ key: 'indexed', retiredBy: 'objectui#4644', sites: { metadataServiceCarryOver: true } }],
          ),
        },
      );
    });
  });

  describe('a retirement is not waivable at a site that strips the key', () => {
    it('⭐ refuses the ledger row, and cites the registry entry instead', async () => {
      // The rule with teeth, measured against the REAL registry: `formula` is
      // retired (objectui#6043) and `metadataServiceCarryOver` strips it, so a
      // KNOWN_UNPARSEABLE_KEYS row cannot quiet a re-declaration there. Its
      // resolution already happened, on the card the tombstone names; a fresh
      // ledger row would re-open a settled retirement in silence.
      await withFixture(
        { [RETIRED_KEY_REGISTRY_FILE]: REAL_REGISTRY, 'payload.ts': declaring('formula') },
        async (dir) => {
          const { violations, staleLedger } = await analyze(dir, {
            shapes: [atSite('metadataServiceCarryOver')],
            ledger: { formula: fieldRow },
          });
          expect(violations.map((v) => `${v.key}:${v.waiverRefused}`)).toEqual(['formula:true']);
          expect(violations[0].retired!.retiredBy).toBe('objectui#6043');
          expect(violations[0].retired!.inForce).toBe(true);
          // ...and the row itself is reported, with the registry's reason
          // rather than the generic "unreachable" one.
          expect(staleLedger.map((s) => s.key)).toEqual(['formula']);
          expect(staleLedger[0].reason).toContain('objectui#6043');
          expect(staleLedger[0].reason).toContain('a retirement cannot be waived by a ledger row');
        },
      );
    });

    it('the citation carries the per-site columns VERBATIM, never flattened', async () => {
      // `formula`'s read-door column is `false` — RULED, objectui#6526 option B
      // (`ObjectFieldInspector` seeds its CEL editor from
      // `def.expression ?? def.formula`, and stripping on read destroys the
      // authored text). The gate reproduces that column on the NOT-stripped
      // side; it never inverts it into a claim that the read door strips it.
      await withFixture(
        { [RETIRED_KEY_REGISTRY_FILE]: REAL_REGISTRY, 'payload.ts': declaring('formula') },
        async (dir) => {
          const { violations } = await analyze(dir, {
            shapes: [atSite('metadataServiceCarryOver')],
            ledger: {},
          });
          expect(violations[0].retired!.strippedAt).toEqual([
            'metadataServiceCarryOver',
            'metadataFieldsPageCarryOver',
          ]);
          expect(violations[0].retired!.notStrippedAt).toEqual(['metadataAdminFieldsReadDoor']);
        },
      );
    });

    it('⭐ the SAME key at a site whose column is `false` stays an ordinary, ledgerable violation', async () => {
      // The anti-flattening proof, on the real registry: `sortOrder` is `true`
      // at `metadataServiceCarryOver` and `false` at
      // `metadataFieldsPageCarryOver` (objectui#6045's recorded verdict — the
      // registry's one defensive, single-site entry). One key, one ledger row,
      // two sites, two different verdicts. A gate holding one flat "retired"
      // set could not produce this pair.
      const files = { [RETIRED_KEY_REGISTRY_FILE]: REAL_REGISTRY, 'payload.ts': declaring('sortOrder') };

      await withFixture(files, async (dir) => {
        const strips = await analyze(dir, {
          shapes: [atSite('metadataServiceCarryOver')],
          ledger: { sortOrder: fieldRow },
        });
        expect(strips.violations.map((v) => `${v.key}:${v.waiverRefused}`)).toEqual(['sortOrder:true']);
        expect(strips.staleLedger.map((s) => s.key)).toEqual(['sortOrder']);
      });

      await withFixture(files, async (dir) => {
        const doesNotStrip = await analyze(dir, {
          shapes: [atSite('metadataFieldsPageCarryOver')],
          ledger: { sortOrder: fieldRow },
        });
        // The registry makes no claim to enforce the retirement at THIS site,
        // so the ordinary ledger path applies and the row is honoured.
        expect(doesNotStrip.violations).toEqual([]);
        expect(doesNotStrip.staleLedger).toEqual([]);
      });
    });

    it('still cites a tombstone at a site that does not strip it, marked not-in-force', async () => {
      // Not silence: the reader is told the key is retired and which sites
      // strip it, so an unledgered re-declaration is adjudicated with the
      // registry in hand rather than from scratch.
      await withFixture(
        { [RETIRED_KEY_REGISTRY_FILE]: REAL_REGISTRY, 'payload.ts': declaring('sortOrder') },
        async (dir) => {
          const { violations } = await analyze(dir, {
            shapes: [atSite('metadataFieldsPageCarryOver')],
            ledger: {},
          });
          expect(violations.map((v) => v.key)).toEqual(['sortOrder']);
          expect(violations[0].retired!.retiredBy).toBe('objectui#6045');
          expect(violations[0].retired!.inForce).toBe(false);
          expect(violations[0].waiverRefused).toBe(false);
        },
      );
    });

    it('a shape that is no strip site at all carries the citation but never the ban', async () => {
      await withFixture(
        { [RETIRED_KEY_REGISTRY_FILE]: REAL_REGISTRY, 'payload.ts': declaring('indexed') },
        async (dir) => {
          const { violations } = await analyze(dir, {
            shapes: [WIRE_SHAPE],
            ledger: { indexed: fieldRow },
          });
          expect(violations).toEqual([]);
        },
      );
    });

    it('⭐ the FIELD registry never reaches the OBJECT oracle — same spelling, two cards', async () => {
      // `sortOrder` is refused at BOTH levels by two different schemas and is
      // two different cards (objectui#6045 field-level, objectui#6223
      // object-level, still the Object Manager's display order). A registry of
      // FIELD tombstones that leaked across the oracle boundary would refuse
      // the object-level card's own ledger row.
      const OBJECT_AT_SITE = {
        id: 'FixtureObjectPayload',
        file: 'object-payload.ts',
        interface: 'FixtureObjectPayload',
        schema: 'ObjectSchema' as const,
        reach: 'wire' as const,
        writer: 'fixture',
        stripSite: 'metadataServiceCarryOver',
      };
      await withFixture(
        {
          [RETIRED_KEY_REGISTRY_FILE]: REAL_REGISTRY,
          'object-payload.ts':
            'export interface FixtureObjectPayload {\n  name?: string;\n  label?: string;\n  sortOrder?: number;\n}\n',
        },
        async (dir) => {
          const ledgered = await analyze(dir, {
            shapes: [OBJECT_AT_SITE],
            ledger: {
              sortOrder: { card: 'objectui#6223', oracle: 'ObjectSchema', spec: null, note: 'fixture' },
            },
          });
          expect(ledgered.violations).toEqual([]);
          expect(ledgered.staleLedger).toEqual([]);
          const bare = await analyze(dir, { shapes: [OBJECT_AT_SITE], ledger: {} });
          expect(bare.violations.map((v) => `${v.key}:${v.oracle}`)).toEqual(['sortOrder:ObjectSchema']);
          expect(bare.violations[0].retired).toBeNull();
        },
      );
    });
  });

  describe('the per-site map, on the real tree', () => {
    it('accounts for every registry site exactly once — shaped or declared shapeless', async () => {
      const registry = readRetiredKeyRegistry(repoRoot);
      const shaped = PAYLOAD_SHAPES.map((s) => s.stripSite).filter(Boolean);
      expect(shaped).toEqual(['metadataServiceCarryOver', 'metadataFieldsPageCarryOver']);
      expect(Object.keys(SITES_WITH_NO_DECLARED_SHAPE)).toEqual(['metadataAdminFieldsReadDoor']);
      expect([...shaped, ...Object.keys(SITES_WITH_NO_DECLARED_SHAPE)].sort()).toEqual(
        [...registry.sites].sort(),
      );
      // Every shape answers the column — an omitted one would opt out of the
      // retirement rule in silence, the way an unnamed oracle used to fall back
      // to the field schema (objectui#6223).
      for (const shape of PAYLOAD_SHAPES) {
        expect(Object.prototype.hasOwnProperty.call(shape, 'stripSite'), `${shape.id} omits stripSite`).toBe(
          true,
        );
      }
    });

    it('maps each site onto the file the registry says it is — a crossed map applies the wrong column', () => {
      // The paths come from the registry's own site docblock. Swapping the two
      // `stripSite` values would leave every other assertion here green while
      // each site was judged by the other's columns.
      const siteFiles: Record<string, string> = {
        metadataServiceCarryOver: 'packages/app-shell/src/services/MetadataService.ts',
        metadataFieldsPageCarryOver: 'packages/plugin-designer/src/MetadataFieldsPage.tsx',
      };
      for (const shape of PAYLOAD_SHAPES.filter((s) => s.stripSite)) {
        expect(shape.file, `${shape.id} is mapped to the wrong site`).toBe(siteFiles[shape.stripSite!]);
      }
    });

    it('⭐ judges NOTHING at the read door — objectui#6526 option B, kept structural', async () => {
      // The ruling: `formula` must NOT be stripped at the read door, because
      // `ObjectFieldInspector` seeds its CEL editor from
      // `def.expression ?? def.formula` and the first edit migrates it. The
      // read door also declares no payload shape at all (coverage note 3), so
      // this gate has nothing there to judge — and that is recorded rather than
      // left to chance. If a shape ever names the read door as its strip site,
      // this is what says so before the gate starts asserting strips there.
      expect(PAYLOAD_SHAPES.map((s) => s.stripSite)).not.toContain('metadataAdminFieldsReadDoor');
      expect(SITES_WITH_NO_DECLARED_SHAPE.metadataAdminFieldsReadDoor).toContain(
        'no statically declared payload shape',
      );
      const { violations, uiOnly } = await analyze(repoRoot);
      for (const entry of [...violations, ...uiOnly]) {
        expect(entry.retired?.site ?? null, `${entry.key} judged at the read door`).not.toBe(
          'metadataAdminFieldsReadDoor',
        );
      }
    });

    it('annotates the retired keys still declared on the UI model, and stays green', async () => {
      // `isSystem` (objectui#6044) and `referenceTo` (objectui#6041) are
      // tombstoned keys the designer's in-memory model still declares; the
      // converters strip them, so they are `uiOnly` and NOT violations. The
      // citation makes that visible in the run log instead of leaving two
      // retired spellings looking like ordinary UI keys.
      const { uiOnly, violations } = await analyze(repoRoot);
      const cited = uiOnly.filter((u) => u.retired).map((u) => `${u.key}:${u.retired!.retiredBy}`);
      expect(cited).toEqual(
        expect.arrayContaining(['isSystem:objectui#6044', 'referenceTo:objectui#6041']),
      );
      // The object-level `sortOrder` on `ObjectDefinition` is a DIFFERENT card
      // and must not be annotated with the field registry's tombstone.
      expect(uiOnly.find((u) => u.key === 'sortOrder' && u.oracle === 'ObjectSchema')?.retired).toBeNull();
      expect(violations).toEqual([]);
    });
  });
});

describe('extraction failure is an error, never a silent pass', () => {
  it('throws when the shape file does not exist', async () => {
    await withFixture({ 'unrelated.ts': '' }, async (dir) => {
      await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(ExtractionError);
    });
  });

  it('throws when the interface was renamed away — zero keys must not read as zero bad keys', async () => {
    await withFixture({ 'payload.ts': 'export interface SomethingElse {\n  indexed?: boolean;\n}\n' }, async (dir) => {
      await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(/not found in payload\.ts/);
    });
  });

  it('throws when the interface declares no properties', async () => {
    await withFixture({ 'payload.ts': 'export interface FixturePayload {}\n' }, async (dir) => {
      await expect(analyze(dir, { shapes: [WIRE_SHAPE], ledger: {} })).rejects.toThrow(/declares no properties/);
    });
  });
});

describe('the real shapes, on the real tree', () => {
  /**
   * One key per shape that identifies THE INTERFACE, not merely some interface
   * — the non-vacuity guard this file used to spell as a literal `label` on
   * every shape. `label` cannot carry it everywhere: an authorization row
   * (`ObjectPerm`, objectui#6606) has no label, while a walk that silently read
   * some other seven-key interface would still have to miss `allowRead`. Every
   * entry in `PAYLOAD_SHAPES` must appear here, so a shape cannot be added
   * unwitnessed and read as verified.
   */
  const SHAPE_WITNESS: Record<string, string> = {
    FieldMetadataPayload: 'label',
    ServerFieldSchema: 'label',
    DesignerFieldDefinition: 'label',
    ObjectMetadataPayload: 'label',
    ServerObjectSchema: 'label',
    ObjectDefinition: 'label',
    PermissionSetDraft: 'objects',
    ObjectPerm: 'allowRead',
  };

  it('finds every declared shape and reads a non-trivial key set from each', async () => {
    for (const shape of PAYLOAD_SHAPES) {
      const { keys } = declaredKeys(repoRoot, shape);
      expect(keys.length, `${shape.id} declared no keys`).toBeGreaterThan(5);
      const witness = SHAPE_WITNESS[shape.id];
      expect(witness, `${shape.id} has no witness key in SHAPE_WITNESS`).toBeTruthy();
      expect(keys, `${shape.id} is missing \`${witness}\``).toContain(witness);
    }
  });

  it('sees the index signature on `ServerFieldSchema` — coverage note 2 must stay true', async () => {
    // The gate's docblock claims a key reaching the payload only through a
    // spread is outside its reach. That claim is only honest while the spread
    // hole is real and visible; if the index signature ever goes away the
    // docblock needs rewriting, not this assertion relaxing.
    const server = PAYLOAD_SHAPES.find((s) => s.id === 'ServerFieldSchema');
    expect(server).toBeDefined();
    expect(declaredKeys(repoRoot, server!).indexSignature).toBe(true);
  });

  it('carries an object-level oracle over both object wire shapes — objectui#6223', async () => {
    // The gate shipped for objectui#5761 had three field shapes and no object
    // shape, so the parent document those fields are nested in was unchecked.
    // If that ever regresses this assertion says so, rather than the next
    // object-level key being found by a user hitting a save-blocking 422.
    const objectShapes = PAYLOAD_SHAPES.filter((s) => s.schema === 'ObjectSchema');
    expect(objectShapes.map((s) => s.id).sort()).toEqual([
      'ObjectDefinition',
      'ObjectMetadataPayload',
      'ServerObjectSchema',
    ]);
    expect(objectShapes.filter((s) => s.reach === 'wire').map((s) => s.id).sort()).toEqual([
      'ObjectMetadataPayload',
      'ServerObjectSchema',
    ]);
    // Every shape names its oracle explicitly — an entry that forgot to would
    // silently fall back to the field schema and be checked against the wrong
    // accept set.
    for (const shape of PAYLOAD_SHAPES) {
      expect(shape.schema, `${shape.id} names no oracle`).toBeTruthy();
    }
  });

  it('keeps `group` and `sortOrder` on the UI model, `relationships` there only as a retired tombstone, and all three off every object wire shape', async () => {
    // The structural claim objectui#6223 landed, asserted on the real tree
    // rather than on a fixture: the Object Manager may hold `group` and
    // `sortOrder` (its display category and display order), and no shape that
    // becomes a PUT body may declare any of the three.
    //
    // objectui#11434 then RETIRED `relationships` from the UI model too: a
    // relationship is a field, and nothing read the list. It is still a property
    // signature there — a `?: never` tombstone, so `tsc` refuses it by name — which
    // is why this gate keeps listing it as UI-only. What this pins is that the
    // signature can carry no value any more.
    const { uiOnly, violations } = await analyze(repoRoot);
    const onObjectDefinition = uiOnly.filter((u) => u.shape === 'ObjectDefinition').map((u) => u.key);
    for (const key of ['group', 'sortOrder']) {
      expect(onObjectDefinition, `${key} left the UI model`).toContain(key);
    }
    for (const key of ['group', 'sortOrder', 'relationships']) {
      expect(violations.map((v) => v.key), `${key} is back on a wire shape`).not.toContain(key);
    }
    const designer = fs.readFileSync(path.join(repoRoot, 'packages/types/src/designer.ts'), 'utf8');
    const start = designer.indexOf('export interface ObjectDefinition {');
    const body = designer.slice(start, designer.indexOf('\n}\n', start));
    // Non-vacuity: the slice is the interface, holding a live member.
    expect(start, 'ObjectDefinition not found in designer.ts').toBeGreaterThan(-1);
    expect(body).toContain('sortOrder?: number;');
    expect(body, 'ObjectDefinition.relationships is no longer the objectui#11434 tombstone').toContain('relationships?: never;');
    expect(designer, 'the retired element type is declared again').not.toMatch(/\binterface ObjectDefinitionRelationship\b/);
    for (const id of ['ObjectMetadataPayload', 'ServerObjectSchema']) {
      const shape = PAYLOAD_SHAPES.find((s) => s.id === id)!;
      const { keys } = declaredKeys(repoRoot, shape);
      expect(keys, `${id} declares group`).not.toContain('group');
      expect(keys, `${id} declares sortOrder`).not.toContain('sortOrder');
      expect(keys, `${id} declares relationships`).not.toContain('relationships');
    }
  });

  it('is green — every refused key on the tree is filed and ledgered', async () => {
    const { violations, staleLedger } = await analyze(repoRoot);
    expect(violations).toEqual([]);
    expect(staleLedger).toEqual([]);
  });

  it('every ledger entry names the card that owns its resolution', async () => {
    // The ledger is REMOVE-only and it is currently EMPTY — every key it ever
    // held has been resolved (objectui#4676 `placeholder`, objectui#6043
    // `formula`, objectui#6045 `sortOrder`, objectui#6238 `enabled`). That is
    // the ratchet arriving where it was pointed, so an empty ledger is the
    // success state and must not be a failure.
    //
    // This case used to open `expect(entries.length).toBeGreaterThan(0)` as its
    // non-vacuity guard, and when objectui#6238 emptied the ledger that
    // assertion inverted into a demand that some key stay UNRESOLVED — with a
    // failure message (`expected 0 to be greater than 0`) whose obvious remedy
    // is to add a row back, i.e. the one edit the header forbids. The guard is
    // kept, pointed at the right thing: the validation must be exercised, and
    // the fixture below is what exercises it when the real ledger is empty.
    const validate = (key: string, entry: { card?: string; note?: string; oracle?: string }) => {
      expect(entry.card, `${key} has no card`).toMatch(/^objectui#\d+$/);
      expect(entry.note, `${key} has no note`).toBeTruthy();
      // objectui#6223: with more than one oracle, an entry that names none
      // silently defaults to the field one and can absorb another level's key.
      // Read from `ORACLES` rather than re-listed, so adding an oracle
      // (objectui#6606 added two) cannot leave this list behind.
      expect(ORACLES, `${key} names no oracle`).toContain(entry.oracle);
    };

    // Non-vacuity, on a fixture rather than on the real tree: the loop body
    // really does reject a malformed entry, whatever the live ledger holds.
    validate('zzzWellFormedFixture', {
      card: 'objectui#0000',
      note: 'fixture',
      oracle: 'FieldSchema',
    });
    expect(() => validate('zzzNoCardFixture', { note: 'fixture', oracle: 'FieldSchema' })).toThrow();
    expect(() => validate('zzzNoOracleFixture', { card: 'objectui#0000', note: 'fixture' })).toThrow();

    for (const [key, entry] of Object.entries(KNOWN_UNPARSEABLE_KEYS)) validate(key, entry);
  });
});
