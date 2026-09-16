import { describe, it, expect } from 'vitest';
import Compile from '../src/commands/compile';
import Serve from '../src/commands/serve';
import Dev from '../src/commands/dev';
import Doctor from '../src/commands/doctor';
import Create from '../src/commands/create';
import Test from '../src/commands/test';
import Validate from '../src/commands/validate';
import Init from '../src/commands/init';
import Info from '../src/commands/info';
import Generate from '../src/commands/generate';
import Lint from '../src/commands/lint';
import Diff from '../src/commands/diff';
import Explain, { SCHEMAS } from '../src/commands/explain';
import { FlowSchema } from '@objectstack/spec/automation';
// The catalog sweep below resolves each entry's schema BY NAME, so it needs the
// name surface rather than one binding. `@objectstack/spec`'s root exports none
// of these Zod schemas (measured: 129 root exports, no `ObjectSchema` /
// `FieldSchema` / … among them) — every one lives on a subpath, so the four
// metadata-authoring subpaths the catalog draws on are named here. The named
// `FlowSchema` import above stays: a value import fails loudly on a broken
// export where a namespace property read would degrade to `undefined`, and the
// sweep pays for its namespace form with an explicit resolvability assertion.
import * as specAi from '@objectstack/spec/ai';
import * as specAutomation from '@objectstack/spec/automation';
import * as specData from '@objectstack/spec/data';
import * as specUi from '@objectstack/spec/ui';

describe('CLI Commands (oclif)', () => {
  it('should have compile command', () => {
    expect(Compile.description).toContain('Compile');
  });

  it('should have serve command', () => {
    expect(Serve.description).toContain('server');
  });

  it('should have dev command', () => {
    expect(Dev.description).toContain('development mode');
  });

  it('should have doctor command', () => {
    expect(Doctor.description).toContain('health');
  });

  it('should have create command', () => {
    expect(Create.description).toContain('Create');
  });

  it('should have test command', () => {
    expect(Test.description).toContain('Quality Protocol');
  });

  it('should have validate command', () => {
    expect(Validate.description).toContain('Validate');
  });

  it('should have init command', () => {
    expect(Init.description).toContain('Initialize');
  });

  it('should have info command', () => {
    expect(Info.description).toContain('summary');
  });

  it('should have generate command with alias', () => {
    expect(Generate.aliases).toContain('g');
    expect(Generate.description).toContain('Generate');
  });

  it('should have lint command', () => {
    expect(Lint.description).toContain('style');
  });

  it('should have diff command', () => {
    expect(Diff.description).toContain('Compare');
  });

  it('should have explain command', () => {
    expect(Explain.description).toContain('explanation');
  });
});

describe('os explain — schema catalog accuracy', () => {
  // Regression guard for #3244: `os explain object` used to document the
  // `ownership` field as the package-contribution kind (`"own" | "extend"`),
  // which is a DISTINCT concept (`ObjectOwnershipEnum`, set via registerObject).
  // The real `ObjectSchema.ownership` field is the record-ownership model —
  // `z.enum(['user','business_unit','org','none'])` — see
  // packages/spec/src/data/object.zod.ts.
  //
  // The token set is asserted EXACTLY, and that exactness is the point: this
  // catalog (`packages/cli/src/commands/explain.ts`) is hand-maintained and does
  // NOT derive from the spec enum, so a spec-side enum change that stops here is
  // invisible to any review that only reads `packages/spec`. #5678 (ADR-0117 D1's
  // fourth tier, `'business_unit'`) is the case that proved it — without the
  // co-update, `os explain object` keeps telling authors a legal tier does not
  // exist. Widen this set only together with the enum it mirrors.
  it('documents object.ownership as the record-ownership model, not the own/extend contribution kind (#3244)', () => {
    const ownership = SCHEMAS.object.optional.find((f) => f.name === 'ownership');
    expect(ownership, 'object schema should document an `ownership` field').toBeDefined();

    // The type string must enumerate exactly the record-ownership enum values.
    const tokens = (ownership!.type.match(/'[^']+'|"[^"]+"/g) ?? []).map((t) => t.slice(1, -1));
    expect(new Set(tokens)).toEqual(new Set(['user', 'business_unit', 'org', 'none']));

    // …and must never regress back to the contribution-kind values.
    expect(ownership!.type).not.toBe('"own" | "extend"');
  });

  // ── `os explain flow` ───────────────────────────────────────────────────
  //
  // The flow entry shipped a sample that could not parse, and the catalog is
  // hand-maintained (it does NOT derive from FlowSchema), so nothing said so:
  //   • `steps` and `trigger` are strictObject ALIASES on FlowSchema (for
  //     `nodes` and `type`) — authoring either is a loud parse error;
  //   • a node's per-type data lives under `config`, so the sample's top-level
  //     `field`/`value` pair are undeclared keys on a `.strict()` node, and its
  //     required `id`/`label` were absent;
  //   • `edges` is required — a graph with no edges was not expressible;
  //   • the value `'$currentUser'` was a `$`-prefixed sentinel NO resolver in
  //     the repo recognises. The flow value dialect is brace-based, and the
  //     acting user is `{$User.Id}` (template.ts `resolveToken`, whose
  //     `$User.Id` branch returns `context.userId`). The neighbouring FILTER
  //     dialect's `{current_user_id}` is a different door and does NOT carry
  //     over: assignment/`fields` values go through plain `interpolate`, not
  //     `interpolateFilter`.
  //
  // Parsing the sample against the real schema is the guard that cannot itself
  // drift — it re-derives the truth from the spec on every run, which is what
  // the hand-maintained catalog otherwise has no way to do.
  // The catalog's element shape, stated locally: `SchemaInfo` is not exported,
  // and these tests must stay honest even where `SCHEMAS` widens to `any`.
  // ⚠️ The reason recorded here has CHANGED and the discipline has not. This
  // file no longer sits outside every tsc program: #14710 landed
  // `packages/cli/tsconfig.test.json`, whose `include: ["test/**/*"]` puts this
  // file in the program (`tsc --noEmit --listFiles -p tsconfig.test.json`
  // resolves it), and it carries NO row in `test-typecheck-debt.json` — so any
  // diagnostic it gains is red on arrival rather than silently unchecked.
  type CatalogField = { name: string; type: string };
  const flowFields = (kind: 'required' | 'optional'): CatalogField[] => SCHEMAS.flow[kind];

  it('ships a flow example that actually parses as a Flow (#14782)', () => {
    // The catalog stores examples as authored source, so evaluate the literal.
    const literal = new Function(`return (${SCHEMAS.flow.example});`)() as unknown;
    const result = FlowSchema.safeParse(literal);
    expect(
      result.success,
      `os explain flow's example must parse as a Flow. Issues: ${
        result.success ? '' : JSON.stringify(result.error.issues, null, 2)
      }`,
    ).toBe(true);
  });

  it('documents flow.type as the full FlowSchema type enum (#14782)', () => {
    const type = flowFields('required').find((f) => f.name === 'type');
    expect(type, 'flow schema should document a `type` field').toBeDefined();
    const tokens = (type!.type.match(/'[^']+'|"[^"]+"/g) ?? []).map((t) => t.slice(1, -1));
    expect(new Set(tokens)).toEqual(
      new Set(['autolaunched', 'record_change', 'schedule', 'screen', 'api']),
    );
  });

  it('teaches the acting user as {$User.Id}, and no catalog example revives $currentUser (#14782)', () => {
    expect(SCHEMAS.flow.example).toContain('{$User.Id}');
    const entries = Object.entries(SCHEMAS) as Array<[string, { example: string }]>;
    for (const [key, info] of entries) {
      expect(info.example, `os explain ${key} example`).not.toContain('$currentUser');
    }
  });

  it('never re-teaches `steps` / `trigger` as flow keys — both are aliases, not fields (#14782)', () => {
    const declared = [...flowFields('required'), ...flowFields('optional')].map((f) => f.name);
    expect(declared).not.toContain('steps');
    expect(declared).not.toContain('trigger');
    expect(declared).toContain('nodes');
    expect(declared).toContain('edges');
  });
});

// ── `os explain` — the WHOLE catalog, swept against the spec (#14811) ──────
//
// #14782 pinned one entry (`flow`) by parsing its `example` against the real
// schema. This generalises that technique to every entry, and derives the entry
// set from `SCHEMAS` itself: a hand-written list of entries is precisely the
// place a future entry escapes through unnoticed, which is the same defect this
// guard closes one level down. Add a catalog entry and this block goes RED
// until the entry is classified.
//
// ⛔ It does NOT fix what it turns red. Rewriting a catalog entry rewrites
// operator-facing output and is a separate change with a separate review
// question, so entries whose example does not parse today land as `it.fails`
// xfails naming the card filed for each. The day one is corrected its xfail
// fails ("expected to fail but passed") — promote it to a plain `it` then.
//
// ⛔ And it does not skip silently. Two entries resolve to no schema at all;
// they get tests that ASSERT that reason. A guard reporting green over the
// entries it never looked at is this card's own defect, one layer up.
describe('os explain — every catalog entry swept against its spec schema (#14811)', () => {
  type CatalogRow = { name: string; type: string; description: string };
  type CatalogEntry = {
    name: string;
    example: string;
    required: CatalogRow[];
    optional: CatalogRow[];
  };
  const catalog = SCHEMAS as unknown as Record<string, CatalogEntry>;

  // The searched name surface, stated rather than assumed: absence below means
  // absent from exactly these four subpaths. (`grep` over `packages/spec/src`
  // finds no `export const TriggerSchema` or `WorkflowSchema` anywhere at all.)
  const specSurface: Record<string, unknown> = {
    ...specData,
    ...specUi,
    ...specAi,
    ...specAutomation,
  };

  type ParseResult = { success: boolean; data?: unknown; error?: { issues: unknown[] } };
  type ZodLike = { safeParse: (value: unknown) => ParseResult };

  // The catalog stores examples as authored source, so evaluate the literal —
  // the same technique as the `flow` pin above.
  const evaluate = (key: string): unknown =>
    new Function(`return (${catalog[key].example});`)() as unknown;

  // Entries with one schema to parse against. `card` marks a known-broken one
  // and names where its errors are recorded; its absence means "must parse".
  //
  // ⭐ The xfail ledger is EMPTY: #15170–#15175 corrected the six entries that
  // carried a card, and each xfail was promoted to the plain assertion below in
  // that same change — which is the whole point of the sweep. Leaving a
  // corrected entry as an `it.fails` would let the identical error return
  // silently, because `it.fails` is green on ANY failure. The machinery stays
  // for the next entry that arrives broken: give it a `card` and it becomes an
  // xfail again, with a filed number attached rather than a quiet skip.
  const BOUND: Record<string, { schema: string; card?: number }> = {
    object: { schema: 'ObjectSchema' },
    field: { schema: 'FieldSchema' },
    view: { schema: 'ViewSchema' },
    flow: { schema: 'FlowSchema' },
    agent: { schema: 'AgentSchema' },
    app: { schema: 'AppSchema' },
    query: { schema: 'QuerySchema' },
    dashboard: { schema: 'DashboardSchema' },
    action: { schema: 'ActionSchema' },
  };

  // Entries with NO single schema to parse against, and the reason each of the
  // two tests at the bottom asserts rather than merely states.
  const UNBOUND: Record<string, string> = {
    workflow:
      'there is no standalone Workflow authoring type (ADR-0019) — the entry is a '
      + 'redirect and its example is commentary, not a literal',
    trigger:
      'ADR-0088 retired the `trigger` metadata kind — no `TriggerSchema` exists and '
      + 'none ever did, so the entry is a redirect to `hook` / a `record_change` flow '
      + 'and its example is commentary, not a literal (#15176)',
  };

  it('classifies every entry in SCHEMAS — none is silently unswept', () => {
    const classified = [...Object.keys(BOUND), ...Object.keys(UNBOUND)].sort();
    expect(
      classified,
      'a new `os explain` catalog entry must be classified here: bind it to a spec '
        + 'schema, or give it an UNBOUND reason plus a test that asserts that reason',
    ).toEqual(Object.keys(catalog).sort());
  });

  // Harness health, asserted separately from the xfails: `it.fails` is green on
  // ANY failure, so a broken subpath export or an unevaluable example would
  // otherwise keep six xfails passing while measuring nothing at all.
  it('resolves every bound entry to a real schema, and every bound example to an object', () => {
    for (const [key, bound] of Object.entries(BOUND)) {
      const schema = specSurface[bound.schema] as ZodLike | undefined;
      expect(typeof schema?.safeParse, `${bound.schema} (for os explain ${key})`).toBe('function');
      expect(typeof evaluate(key), `os explain ${key} example`).toBe('object');
    }
  });

  for (const [key, bound] of Object.entries(BOUND)) {
    const parses = (): void => {
      const schema = specSurface[bound.schema] as ZodLike;
      const result = schema.safeParse(evaluate(key));
      expect(
        result.success,
        `os explain ${key}: its example must parse as ${bound.schema}. Issues: ${
          result.success ? '' : JSON.stringify(result.error?.issues, null, 2)
        }`,
      ).toBe(true);
    };

    if (bound.card === undefined) {
      it(`os explain ${key} — example parses as ${bound.schema}`, parses);
    } else {
      it.fails(
        `os explain ${key} — example does NOT parse as ${bound.schema} `
          + `(known-broken, filed as #${bound.card}; promote to a plain assertion once fixed)`,
        parses,
      );
    }
  }

  // ── Key RETENTION: an example must SURVIVE its parse, not merely pass it ────
  //
  // The sweep above asserts `safeParse(...).success === true` — and that stays
  // green over a key the schema SILENTLY STRIPS, because a plain `z.object`
  // drops what it does not declare and still reports success. The `query` entry
  // shipped teaching `filters` and `sort`, neither of them a `QuerySchema` key,
  // and every run of the sweep above was green on it (#16925). "Parses" is
  // therefore not the property worth asserting on its own; "parses AND comes
  // back whole" is, and only the second one can see this failure mode.
  //
  // ⭐ This is a RATCHET, not a patch over a large hole. All nine bound entries
  // were read back to spec on the day it landed: eight refuse an unknown key
  // outright — seven `strictObject`, plus `object`, whose docblock states the
  // "No silent strip (ADR-0032 / #1535)" contract explicitly — and `query` alone
  // had an open top level, deliberately so and already owned (`query.zod.ts`:
  // "Deliberately NOT taken here: `BaseQuerySchema`'s own top level stays
  // non-strict. That is #4001's to schedule."). So it is green across the whole
  // catalog the day it lands. What it defends is the day a bound entry resolves
  // to an open top level again: the direction of travel is *closing*, and this
  // is what notices if that reverses — with the entry named, instead of a green
  // sweep over a silently emptied example.
  //
  // It reads the EXAMPLE face only — the one face `evaluate` reads. The
  // `optional` / `required` tables carry key names too, and a row naming a key
  // the schema does not have is the same defect on the other face (#16925's own
  // `filters` / `sort` lived on BOTH). That face is covered by its own block
  // below (#17266) rather than by a stricter version of this assertion, because
  // it is a different question: a table row is prose until something decides it
  // is a key name, so the other block has to carry that rule before it can judge
  // any row at all.
  //
  // The walk is deliberately conservative — it reports a key present in the
  // INPUT and absent from the OUTPUT, and nothing else. Keys a schema ADDS
  // (defaults) are not drift; a value a schema TRANSFORMS to a non-object is not
  // a dropped key, so the walk stops rather than guessing. Arrays are matched
  // positionally, which is what every schema in this catalog does today.
  const isWalkable = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !(value instanceof Date);

  const droppedKeys = (
    input: unknown,
    output: unknown,
    path: string[] = [],
    out: string[] = [],
  ): string[] => {
    if (Array.isArray(input)) {
      if (!Array.isArray(output)) return out;
      input.forEach((item, i) => droppedKeys(item, output[i], [...path, String(i)], out));
      return out;
    }
    if (!isWalkable(input) || Array.isArray(output) || !isWalkable(output)) return out;
    for (const key of Object.keys(input)) {
      if (!Object.prototype.hasOwnProperty.call(output, key)) out.push([...path, key].join('.'));
      else droppedKeys(input[key], output[key], [...path, key], out);
    }
    return out;
  };

  for (const [key, bound] of Object.entries(BOUND)) {
    if (bound.card === undefined) {
      it(`os explain ${key} — example survives ${bound.schema} with every declared key intact`, () => {
        const schema = specSurface[bound.schema] as ZodLike;
        const example = evaluate(key);
        const result = schema.safeParse(example);
        // Retention is only a question about a parse that succeeded — stated,
        // so a failure here reads as "the parse broke" and not as a drop.
        expect(
          result.success,
          `os explain ${key}: its example must parse before retention can be judged`,
        ).toBe(true);
        expect(
          droppedKeys(example, result.data),
          `os explain ${key}: ${bound.schema} SILENTLY DROPPED key(s) its example declares. `
            + 'The example teaches keys the schema does not have, so an author who copies it '
            + 'gets a parse that succeeds and a value with those keys gone — no error, no '
            + 'warning. Correct the example to the schema\'s own spellings (⛔ do not relax '
            + 'the schema to accept them). The `parses` assertion above cannot see this: a '
            + 'non-strict object reports success and strips.',
        ).toEqual([]);
      });
    } else {
      // Asserted, never skipped: an entry whose example does not parse cannot be
      // judged for retention, and that reason is a property of this file rather
      // than an omission the reader has to notice.
      it(
        `os explain ${key} — retention NOT judged: its example does not parse yet `
          + `(known-broken, filed as #${bound.card})`,
        () => {
          const schema = specSurface[bound.schema] as ZodLike;
          expect(schema.safeParse(evaluate(key)).success).toBe(false);
        },
      );
    }
  }


  // ── The OTHER face: the `required` / `optional` TABLE rows (#17266) ─────────
  //
  // Everything above judges the `example`. An entry has a second face that names
  // keys — the two tables — and until this block landed no assertion in this
  // file had ever read a row's `name` against a schema. (`SCHEMAS.object
  // .optional.find(…)` in the #3244 pin above reads one row's `type` STRING; it
  // never asks whether the row's NAME is a key.) The trap is the same one, on
  // the other face and a step earlier: a reader copies a row, the schema
  // silently strips the key, and the query runs unfiltered under an ordinary
  // success. `os explain query` shipped `filters` / `sort` on BOTH faces; only
  // the example half was guarded.
  //
  // ⭐ The design work is the ROW GRAMMAR, because a row's `name` is prose until
  // something decides it is a key name. The declared rule: a row name is read as
  // an ALTERNATION — split on `|`, trim — and the row is judged iff EVERY part
  // is a bare identifier. That is deliberately wider than "one identifier": it
  // is what makes `view`'s required row (`list | form | listViews | formViews`,
  // four slot names in the `name` position) judgeable as four keys instead of
  // waved through as prose. A row that does not fit the grammar is NOT silently
  // skipped — it must be declared in `PROSE_ROWS` below, and a declaration that
  // stops being needed fails too, so a stale one cannot go on un-judging a row.
  //
  // ⭐ Two techniques, because one entry does not read. `.shape` is the schema's
  // own declared key set and is the primary reading; eight of the nine bound
  // entries expose one. `ActionSchema` does not — it resolves to a pipe
  // (`lazySchema(() => actionObject().refine(…))`), and a pipe has no shape — so
  // its twelve rows are judged by ASKING the schema instead: plant the row's key
  // on the entry's own parsing example with a sentinel value and read the
  // verdict, never the value's validity. Measured across all nine entries on the
  // day this landed, the two techniques agree on every row the shape one can
  // see, and the probe returns ABSENT for control names on all nine — including
  // `query`, whose open top level answers by DROPPING rather than refusing.
  //
  // ⛔ Each entry's test carries that control inline, and it is load-bearing
  // rather than decorative: `action` has no second opinion, so a technique that
  // answered "declared" to everything would report green over twelve rows and be
  // indistinguishable from a real pass.
  //
  // ⛔ Like the sweep above, it does NOT fix what it turns red, and ⛔ it is
  // never the schema that gives way: a row naming a key the schema does not have
  // is corrected on the ROW (`packages/spec` is not this file's to relax).

  // Row names that are prose rather than key names, each with the reason it
  // cannot be judged, keyed `<entry>.<face>.<row name>`.
  //
  // ⭐ EMPTY today, and measured so: every row on all nine bound entries is a key
  // name or an alternation of them. A new prose row turns the block below RED
  // until it is declared here — ⛔ widening the grammar to make it green again
  // re-opens exactly the face this block exists to close.
  const PROSE_ROWS: Record<string, string> = {};

  const KEY_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  // `null` = prose: this row names no keys, so nothing below can judge it.
  const rowKeyNames = (rowName: string): string[] | null => {
    const parts = rowName.split('|').map((part) => part.trim());
    return parts.every((part) => KEY_NAME.test(part)) ? parts : null;
  };

  // Technique 1 — the schema's own declared key set. `null` when the name does
  // not resolve to something carrying a shape, which is the `action` case.
  const declaredKeys = (schema: ZodLike): Set<string> | null => {
    const shape = (schema as unknown as { shape?: unknown }).shape;
    const resolved = typeof shape === 'function' ? (shape as () => unknown)() : shape;
    if (typeof resolved !== 'object' || resolved === null || Array.isArray(resolved)) return null;
    return new Set(Object.keys(resolved));
  };

  // Technique 2 — ask the schema. Three readings, none of them about whether the
  // VALUE is acceptable:
  //   • an `unrecognized_keys` issue naming the key -> ABSENT (a strict object
  //     refused it by name);
  //   • success with the key gone from the output -> ABSENT (an open object
  //     stripped it silently — the failure mode this whole section exists for);
  //   • anything else -> DECLARED. Either it survived, or the schema validated it
  //     and rejected the sentinel — and only a key it knows can be validated. A
  //     cross-field refinement cannot land here on an absent key: a strict object
  //     reports the unknown key first, and an open one drops it before any
  //     refinement sees it.
  const PROBE_SENTINEL = '__os_explain_table_face_probe__';

  const probeKey = (schema: ZodLike, example: unknown, key: string): boolean => {
    const input = { ...(example as Record<string, unknown>), [key]: PROBE_SENTINEL };
    const result = schema.safeParse(input);
    if (result.success) {
      return isWalkable(result.data) && Object.prototype.hasOwnProperty.call(result.data, key);
    }
    const issues = (result.error?.issues ?? []) as Array<{ code?: string; keys?: string[] }>;
    return !issues.some(
      (issue) => issue.code === 'unrecognized_keys' && issue.keys?.includes(key),
    );
  };

  // A name no schema in this catalog declares, planted as the inline control.
  const CONTROL_KEY = 'os_explain_table_face_control_key';

  for (const [key, bound] of Object.entries(BOUND)) {
    it(`os explain ${key} — every ${bound.schema} table row names a key the schema declares`, () => {
      const schema = specSurface[bound.schema] as ZodLike;
      const declared = declaredKeys(schema);
      // The probe plants its key on the entry's own example, so it needs one
      // that parses. Asserted rather than assumed: an entry that is BOTH
      // known-broken and shape-less is judgeable by neither technique, and this
      // says so instead of reporting green over rows nothing looked at.
      if (declared === null) {
        expect(
          bound.card,
          `os explain ${key}: ${bound.schema} has no readable shape, so its rows can only `
            + 'be judged by planting keys on an example that parses — and this entry is '
            + 'filed as known-broken, so its example does not. A third technique is owed '
            + 'here; ⛔ do not let the rows go unjudged.',
        ).toBeUndefined();
      }
      const example = declared === null ? evaluate(key) : undefined;
      const technique = declared === null ? 'probe' : 'shape';
      const isDeclaredKey = (name: string): boolean =>
        declared === null ? probeKey(schema, example, name) : declared.has(name);

      // Control: a name the schema cannot possibly declare must read ABSENT.
      // Without it, a technique that answers "declared" to everything reports
      // green over every row below — and for `action` there is no second
      // opinion to catch that.
      expect(
        isDeclaredKey(CONTROL_KEY),
        `os explain ${key}: the ${technique} technique called \`${CONTROL_KEY}\` a declared `
          + `key of ${bound.schema}. It cannot tell a real key from an absent one, so every `
          + 'row verdict in this test is meaningless.',
      ).toBe(false);

      const offenders: string[] = [];
      const undeclaredProse: string[] = [];
      const staleProse: string[] = [];

      for (const face of ['required', 'optional'] as const) {
        for (const row of catalog[key][face]) {
          const id = `${key}.${face}.${row.name}`;
          const names = rowKeyNames(row.name);
          if (names === null) {
            if (PROSE_ROWS[id] === undefined) undeclaredProse.push(id);
            continue;
          }
          if (PROSE_ROWS[id] !== undefined) {
            staleProse.push(id);
            continue;
          }
          for (const name of names) {
            if (!isDeclaredKey(name)) offenders.push(`${face} row \`${row.name}\` -> \`${name}\``);
          }
        }
      }

      expect(
        undeclaredProse,
        `os explain ${key}: table row(s) whose \`name\` is neither a key name nor an `
          + 'alternation of them, so nothing here can judge them. Either spell the row as key '
          + 'names, or declare it in `PROSE_ROWS` with the reason — ⛔ do not widen the '
          + 'grammar, which un-judges every row it lets through.',
      ).toEqual([]);

      expect(
        staleProse,
        `os explain ${key}: \`PROSE_ROWS\` declares row(s) that DO parse as key names now. A `
          + 'stale declaration goes on un-judging a row that could be judged — delete the '
          + 'entry.',
      ).toEqual([]);

      expect(
        offenders,
        `os explain ${key}: table row(s) name key(s) ${bound.schema} does NOT declare `
          + `(judged by the ${technique} technique). An author who copies such a row gets a `
          + 'parse that succeeds and a value with that key gone — no error, no warning, and '
          + 'a query that runs unfiltered. Correct the ROW to the schema\'s own spelling '
          + '(⛔ do not relax the schema to accept it).',
      ).toEqual([]);
    });
  }

  // The same completeness property the `classifies every entry` test asserts for
  // the catalog, asserted for this face: the two UNBOUND entries have no schema
  // to judge rows against, so the sweep above cannot reach them. Green over rows
  // nothing looked at is the defect this whole section is about, so their
  // emptiness is asserted rather than assumed.
  it('the two UNBOUND entries carry no table rows — no key name on this face is unswept', () => {
    for (const key of Object.keys(UNBOUND)) {
      expect(
        [...catalog[key].required, ...catalog[key].optional].map((row) => row.name),
        `os explain ${key} is a redirect with no schema to judge rows against, so a table `
          + 'row here names keys nothing can check. Bind the entry to a schema, or keep the '
          + 'tables empty and put the guidance in the description.',
      ).toEqual([]);
    }
  });

  it(`os explain workflow — ${UNBOUND.workflow}`, () => {
    expect('WorkflowSchema' in specSurface).toBe(false);
    expect(catalog.workflow.name).toContain('no standalone type');
    // Its example is commentary about the live mechanisms, not a literal.
    // Asserted, so "nothing was parsed here" is a property of this file rather
    // than an omission a reader has to notice.
    expect(() => evaluate('workflow')).toThrow();
  });

  it(`os explain trigger — ${UNBOUND.trigger}`, () => {
    expect('TriggerSchema' in specSurface).toBe(false);
    expect(catalog.trigger.name).toContain('no standalone type');
    // The redirect points at a mechanism that EXISTS — asserted, not assumed.
    // Before #15176 this line ruled `HookSchema` out as a candidate for the old
    // entry's literal (`event` is a strict-object ALIAS of `events`, and a
    // hook's code slot is `body`/`handler`, so its `flow` key was unrecognised).
    // The entry no longer offers a literal to rule out; what the assertion has
    // to defend now is the other half — that the reader is being sent somewhere
    // real. A redirect naming a schema the spec does not have would be the same
    // defect one level up.
    const hook = specSurface.HookSchema as ZodLike | undefined;
    expect(typeof hook?.safeParse, 'HookSchema — the mechanism this entry redirects to').toBe('function');
    // Its example is commentary about the live mechanisms, not a literal —
    // asserted for the same reason the `workflow` entry above asserts it, so
    // "nothing was parsed here" is a property of this file rather than an
    // omission a reader has to notice.
    expect(() => evaluate('trigger')).toThrow();
  });
});
