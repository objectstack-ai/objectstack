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
  // and these tests must stay honest even where `SCHEMAS` widens to `any`
  // (this file sits outside every tsc program — see the TEST_DEBT ledger — so
  // an implicit `any` here would silently stop checking anything).
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
