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
  type CatalogEntry = { name: string; example: string };
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

  type ParseResult = { success: boolean; error?: { issues: unknown[] } };
  type ZodLike = { safeParse: (value: unknown) => ParseResult };

  // The catalog stores examples as authored source, so evaluate the literal —
  // the same technique as the `flow` pin above.
  const evaluate = (key: string): unknown =>
    new Function(`return (${catalog[key].example});`)() as unknown;

  // Entries with one schema to parse against. `card` marks a known-broken one
  // and names where its errors are recorded; its absence means "must parse".
  const BOUND: Record<string, { schema: string; card?: number }> = {
    object: { schema: 'ObjectSchema', card: 15170 },
    field: { schema: 'FieldSchema' },
    view: { schema: 'ViewSchema', card: 15171 },
    flow: { schema: 'FlowSchema' },
    agent: { schema: 'AgentSchema', card: 15172 },
    app: { schema: 'AppSchema', card: 15173 },
    query: { schema: 'QuerySchema' },
    dashboard: { schema: 'DashboardSchema', card: 15174 },
    action: { schema: 'ActionSchema', card: 15175 },
  };

  // Entries with NO single schema to parse against, and the reason each of the
  // two tests at the bottom asserts rather than merely states.
  const UNBOUND: Record<string, string> = {
    workflow:
      'there is no standalone Workflow authoring type (ADR-0019) — the entry is a '
      + 'redirect and its example is commentary, not a literal',
    trigger:
      'no `TriggerSchema` exists in the spec, and the sample is not a Hook either (#15176)',
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
    // …and it is not `HookSchema` under another name. Ruling the one real
    // candidate out is what makes the unbound classification a measurement
    // instead of an assumption: `event` is a strict-object ALIAS of `events`
    // (the same alias-as-a-documented-key failure the `flow` entry had), and a
    // hook's code slot is `handler`, so the entry's `flow` key is unrecognised.
    const hook = specSurface.HookSchema as ZodLike | undefined;
    expect(typeof hook?.safeParse, 'HookSchema — the candidate this rules out').toBe('function');
    expect(hook!.safeParse(evaluate('trigger')).success).toBe(false);
  });
});
