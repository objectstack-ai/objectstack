// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19568 — the DATASOURCE write door, and the reading that decided it.
 *
 * ## The state this closes
 *
 * `DEFAULT_METADATA_TYPE_REGISTRY` declares `datasource` with
 * `allowRuntimeCreate: true` — Studio's wizard, REST `/meta` and an MCP/AI
 * author may all mint one at runtime — and no rule named it in `runtimeTypes`,
 * so a datasource write built no snapshot and dispatched no rule at all. It is
 * the same ADR-0049 declared-not-enforced shape the ruling 「declared ⇒
 * honoured; not honourable ⇒ retired」 graded ten types under, and it was
 * missed by that census for a mechanical reason worth keeping: its registry
 * entry is the only MULTI-LINE one, so every single-line reader of the
 * registry is blind to it.
 *
 * ## The reading, because this type was OUTSIDE the ruled ten
 *
 * Its group had to be measured rather than inherited, and both arms the card
 * offered were tested against the ruling's own criteria:
 *
 *  - **RETIRE (`allowRuntimeCreate: false`) is refuted.** That arm is for a
 *    declaration 「no stack collection exists to create into」, a promise
 *    nothing can keep. `ObjectStackDefinitionSchema.datasources` is a
 *    first-class stack collection, the type has a live runtime create path
 *    (ADR-0015 Addendum, `origin: 'runtime'`), and retiring the flag would
 *    withdraw a capability the platform ships and Setup renders.
 *  - **The `skill` HOLD-OUT is refuted, and this is the arm that mattered.**
 *    `skill` was held back because its bridge — `validateAiToolReferences` —
 *    resolves references into `stack.tools` / `stack.actions`, collections the
 *    door's snapshot does not carry, so the door reached a verdict the whole
 *    stack does not share and wiring it would have shipped a FALSE advisory
 *    into Studio. `datasource`'s only candidate resolves into nothing: it
 *    judges each written item's own top-level keys against that type's
 *    liveness ledger. The door's verdict and the whole-stack verdict are
 *    therefore the same value, and that is asserted below as a comparison
 *    rather than argued.
 *
 * ⇒ the honest group is the ledger-driven one (`email_template` / `mapping`),
 * not group A's behavioural one, and this file says so in the only way that
 * cannot rot.
 *
 * ## ⚠️ Read the size of this proof before trusting it — it is smaller in one
 *    place and LARGER in another than its group C siblings'
 *
 * SMALLER: the shipped `datasource` ledger carries 0 warn keys, so no
 * authored datasource can be refused or advised at this door today. The
 * deliverable is the wiring, under the same fence the ruling put on group C
 * (「the empty warn maps stay empty until a real property needs a row」 — ⛔ no
 * ledger-population work, zero pull). The silence is pinned, and it carries a
 * LIT CONTROL on the same instrument in the same process so it can never be
 * read as a broken dispatch or an unresolvable ledger directory.
 *
 * LARGER: group C's stack keys are held by ONE string assertion, because with
 * an empty warn map no behavioural case can tell `'mappings'` from a
 * `'mapping'` typo. This file closes that gap for its own row by driving the
 * real rule through its ledger-directory seam (#19268) over a stack built at
 * `stackKeyForType('datasource')` itself — so the `seed: 'data'` failure shape
 * reds a case here, with the wrong-key leg asserted beside it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  authorWarnedProperties,
  lintLivenessProperties,
  // #19268 walk seam — package-internal (module export only; `src/index.ts`
  // re-exports neither, and this package publishes exactly `.` and
  // `./runtime`). The rule against a ledger directory the test controls, and
  // the resolver that finds the real one to copy.
  lintLivenessPropertiesFromLedgerDir,
  resolveLivenessDir,
} from './lint-liveness-properties.js';
import { REFERENCE_INTEGRITY_RULES } from './reference-integrity-suite.js';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';

/** The resolution universe a real per-write snapshot carries. */
const OBJECTS = [
  {
    name: 'acme_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: {
      status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
      total: { type: 'currency', label: 'Total' },
    },
  },
];

const CONTEXT = { objects: OBJECTS };

const dump = (r: { errors: readonly unknown[]; advisories: readonly unknown[] }) =>
  JSON.stringify({ errors: r.errors, advisories: r.advisories });

// ─── The synthetic ledger directory (#19268 seam) ────────────────────────────

const tempLedgerDirs: string[] = [];

afterAll(() => {
  for (const dir of tempLedgerDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A `datasource.json` whose only row is synthetic. It asserts nothing about
 * what the SHIPPED ledger classifies — that stays the job of the measurement
 * pin below — and in exchange no future ledger flip can empty these cases.
 * `status: 'dead'` is explicit because `describe()` throws on a status it does
 * not recognise.
 */
const SYNTHETIC_DATASOURCE_LEDGER = {
  props: {
    synthWarnedSlot: {
      status: 'dead',
      authorWarn: true,
      authorHint: 'synthetic — this row exists only in a test ledger directory',
    },
  },
};

/** A throwaway copy of the shipped ledger directory, `datasource.json` replaced. */
function syntheticDatasourceLedgerDir(): string {
  const shipped = resolveLivenessDir();
  if (!shipped) {
    throw new Error('the shipped liveness directory did not resolve; this file depends on it');
  }
  const dir = mkdtempSync(join(tmpdir(), 'os-datasource-ledger-'));
  tempLedgerDirs.push(dir);
  cpSync(shipped, dir, { recursive: true });
  writeFileSync(join(dir, 'datasource.json'), JSON.stringify(SYNTHETIC_DATASOURCE_LEDGER));
  return dir;
}

/** A runtime-authored datasource, of the shape Setup's wizard persists. */
const datasource = (over: Record<string, unknown> = {}) => ({
  name: 'acme_warehouse',
  label: 'Acme Warehouse',
  driver: 'postgres',
  schemaMode: 'external',
  config: { host: 'localhost', port: 5432, database: 'analytics' },
  active: true,
  origin: 'runtime',
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#19568 — the `datasource` door is declared, mapped and reachable', () => {
  it('a datasource write dispatches a rule and maps to a stack key', () => {
    // Three halves, because any one alone is the "looks wired, enforces
    // nothing" state: the type is gated, some rule runs for it, and the gate
    // can build a snapshot for it. Without the mapping the gate finds the
    // rules, builds no snapshot and returns clean.
    expect(runtimeGatedTypes()).toContain('datasource');
    expect(
      runtimeAuthoringRulesFor('datasource').map((r) => r.name),
      'no rule declares `datasource`',
    ).toContain('lintLivenessProperties');
    expect(stackKeyForType('datasource')).toBe('datasources');
  });

  it('⭐ the stack key is the collection the crossed rule actually READS', () => {
    // The `seed: 'data'` failure, asked behaviourally rather than as a string
    // comparison: the stack is built at whatever key the gate would map a
    // datasource write into, and the real rule is driven over it. A
    // `datasource: 'datasource'` typo lands the item in a collection the walk
    // never reads and reds this case.
    const dir = syntheticDatasourceLedgerDir();
    const key = stackKeyForType('datasource');
    expect(key).not.toBeNull();

    const findings = lintLivenessPropertiesFromLedgerDir(dir, {
      [key as string]: [datasource({ synthWarnedSlot: true })],
    });

    expect(findings.map((f) => f.where)).toEqual(["datasource 'acme_warehouse'"]);
    expect(findings[0].message).toContain('synthWarnedSlot');

    // The leg that makes the one above discriminating rather than decorative:
    // the same item, the same ledger, under the wrong collection name.
    expect(
      lintLivenessPropertiesFromLedgerDir(dir, {
        datasource: [datasource({ synthWarnedSlot: true })],
      }),
      'a wrong stack key must produce nothing — otherwise the case above proves nothing',
    ).toEqual([]);
  });
});

describe('#19568 — wired, dispatched, and silent by ledger', () => {
  it('the door really dispatches the ledger rule for a datasource write', () => {
    const result = runRuntimeAuthoringRules({
      type: 'datasource',
      item: datasource(),
      context: CONTEXT,
    });

    expect(
      result.rulesRun,
      '`datasource` must reach lintLivenessProperties — the wiring is the deliverable',
    ).toContain('lintLivenessProperties');
  });

  it('⭐ MEASURED — and the rule judges NOTHING today, because its ledger warns on nothing', () => {
    // The report's first reading for this type, pinned rather than remembered:
    // `packages/spec/liveness/datasource.json` carries 0 warn keys. ⛔ No
    // ledger-population work is dispatched with this crossing (zero pull); the
    // day a datasource property earns an `authorWarn` row this door lights up
    // with no second edit, which is what the dispatch pin above is for.
    expect([...authorWarnedProperties('datasource')]).toEqual([]);

    const result = runRuntimeAuthoringRules({
      type: 'datasource',
      // Every authorable block the schema carries, so the silence is measured
      // over a rich document rather than a bare one.
      item: datasource({
        description: 'Analytics warehouse',
        pool: { min: 1, max: 5 },
        ssl: { enabled: true, rejectUnauthorized: true },
        external: { allowWrites: false, validation: { onMismatch: 'warn', checkOnBoot: true } },
        autoConnect: true,
      }),
      context: CONTEXT,
    });

    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⭐ LIT CONTROL — the same instrument, in this same process, DOES fire on a ledger that warns', () => {
    // Without this the zeros above are unreadable: a silent rule and an
    // unresolvable ledger directory look identical from the outside. This asks
    // `lintLivenessProperties` the one question whose answer is non-empty today
    // (`object.externalSharingModel` is `authorWarn` in tree), so the zeros are
    // attributable to the empty warn map and to nothing else.
    expect(authorWarnedProperties('object').size).toBeGreaterThan(0);
    const findings = lintLivenessProperties({
      objects: [{ name: 'acme_invoice', externalSharingModel: 'read' }],
    });

    expect(
      findings.map((f) => f.where + ' ' + f.message).join(' | '),
      'the ledger directory resolves and the rule produces findings here',
    ).toContain('externalSharingModel');
  });
});

describe('#19568 — the hold-out test: what the door sees is what the whole stack sees', () => {
  it('⭐ the door-shaped snapshot and the whole stack reach the IDENTICAL verdict', () => {
    // The `skill` measurement (#19527), asked of this type. There, the door's
    // snapshot lacked `stack.tools` / `stack.actions`, so one rule produced
    // `ai-skill-tool-unresolved` at the door and `[]` over the whole stack —
    // a falsehood rendered in Studio, and the reason that type is held out.
    //
    // Here the two runs are the same rule over the same written item, once in
    // the shape a per-write snapshot has (objects + the written collection),
    // once with every collection the door does NOT carry present and populated.
    // Identical output ⇒ there is no universe this verdict depends on that the
    // door cannot see.
    const dir = syntheticDatasourceLedgerDir();
    const written = datasource({ synthWarnedSlot: true });

    const atTheDoor = lintLivenessPropertiesFromLedgerDir(dir, {
      objects: OBJECTS,
      datasources: [written],
    });

    const wholeStack = lintLivenessPropertiesFromLedgerDir(dir, {
      objects: OBJECTS,
      datasources: [
        { name: 'acme_legacy', label: 'Legacy', driver: 'sqlite', config: { filename: ':memory:' } },
        written,
      ],
      // The three collections the snapshot does not carry, populated.
      tools: [{ name: 'acme_tool', label: 'Tool', type: 'function' }],
      actions: [{ name: 'acme_action', label: 'Action', type: 'script', target: 'ping' }],
      flows: [{ name: 'acme_flow', label: 'Flow', trigger: { type: 'manual' }, nodes: [] }],
    });

    const forWritten = (findings: readonly { where: string; rule: string; message: string }[]) =>
      findings
        .filter((f) => f.where.includes('acme_warehouse'))
        .map((f) => `${f.rule} · ${f.where} · ${f.message}`);

    // Anti-vacuity first: two empty lists would compare equal and prove
    // nothing.
    expect(forWritten(atTheDoor).length).toBeGreaterThan(0);
    expect(forWritten(atTheDoor)).toEqual(forWritten(wholeStack));
  });
});

describe('#19568 — CONTROL: the shipped corpus datasources stay publishable', () => {
  it('every code-defined datasource in the example apps publishes clean through the door', () => {
    // `examples/app-showcase` and `examples/app-crm`, verbatim — the whole
    // authored population of this type across the example apps.
    const corpus = [
      {
        name: 'showcase_external',
        label: 'External Analytics (SQLite)',
        driver: 'sqlite',
        schemaMode: 'external',
        config: { filename: '.objectstack/data/showcase_external.db' },
        external: {
          allowWrites: false,
          validation: { onMismatch: 'warn', checkOnBoot: true },
        },
        active: true,
      },
      {
        name: 'crm_primary',
        label: 'CRM Primary Database',
        driver: 'sqlite',
        config: { filename: ':memory:' },
        active: true,
      },
      {
        name: 'crm_analytics',
        label: 'CRM Analytics',
        driver: 'sqlite',
        config: { filename: ':memory:' },
        active: true,
      },
    ];

    for (const item of corpus) {
      const result = runRuntimeAuthoringRules({ type: 'datasource', item, context: CONTEXT });
      expect(result.errors, `${item.name}: ${dump(result)}`).toEqual([]);
      expect(result.advisories, `${item.name}: ${dump(result)}`).toEqual([]);
    }
  });
});

describe('#19568 — DARK: what this crossing did NOT widen', () => {
  it('a datasource write reaches the ledger rule and NOTHING else', () => {
    expect(runtimeAuthoringRulesFor('datasource').map((r) => r.name)).toEqual([
      'lintLivenessProperties',
    ]);
  });

  it('no reference-integrity member claims a datasource write', () => {
    // The entry-level `runtimeTypes` says which WRITES dispatch the suite; the
    // per-member `runtimeTypes` says which MEMBERS judge that snapshot. Asked
    // against the real table, so a member widened onto this type without this
    // file noticing fails here.
    const members = REFERENCE_INTEGRITY_RULES.filter((m) =>
      (m.runtimeTypes ?? ['flow']).includes('datasource')).map((m) => m.name);
    expect(members).toEqual([]);
  });

  it('the types still awaiting their own readings are untouched', () => {
    // The standing ungated controls: group B reads `translation` / `tool`
    // first, group D retires `doc` / `external_catalog`, and `skill` is held
    // out on the measurement this file tested itself against.
    expect(runtimeAuthoringRulesFor('translation')).toEqual([]);
    expect(runtimeAuthoringRulesFor('tool')).toEqual([]);
    expect(runtimeAuthoringRulesFor('doc')).toEqual([]);
    expect(runtimeAuthoringRulesFor('external_catalog')).toEqual([]);
    expect(runtimeAuthoringRulesFor('skill')).toEqual([]);
    expect(stackKeyForType('skill')).toBeNull();
  });
});
