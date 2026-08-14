// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5068 — the SDUI component-props gate.
//
// The hole this closes was measured through the SAME door the fix uses, before
// the rule was wired: `runAuthoringRules('validate', …)` on a page carrying
// `properties: { title: 'T', titel: 'typo' }` reported ZERO findings — from the
// whole registry, not just from this rule. Same for a wrongly-typed prop and
// for a misspelled key one layer down inside `fields[]`. The two probes that
// must stay silent (an unregistered `type`, and `readonly` — declared at #5176)
// reported zero in both states, which is what makes the other three mean
// something.
import { describe, expect, it } from 'vitest';
import { normalizeStackInput } from '@objectstack/spec';
import {
  validateComponentProps,
  COMPONENT_PROPS_UNKNOWN_KEY,
  COMPONENT_PROPS_INVALID,
} from './validate-component-props.js';
import { runAuthoringRules, AUTHORING_RULES } from './authoring-rules.js';

type AnyRec = Record<string, unknown>;

/** One page, one region, the given components. */
const stackWith = (components: unknown[], pageExtra: AnyRec = {}): AnyRec => ({
  pages: [
    {
      name: 'probe_page',
      label: 'Probe',
      type: 'home',
      object: 'task',
      regions: [{ name: 'main', components }],
      ...pageExtra,
    },
  ],
});

const unknownKeys = (f: ReturnType<typeof validateComponentProps>) =>
  f.filter((x) => x.rule === COMPONENT_PROPS_UNKNOWN_KEY);
const invalid = (f: ReturnType<typeof validateComponentProps>) =>
  f.filter((x) => x.rule === COMPONENT_PROPS_INVALID);

describe('validateComponentProps — undeclared keys', () => {
  it('reports a key the type\'s props schema does not declare, with the near-miss named', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:header', properties: { title: 'T', titel: 'typo' } }]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    const [f] = unknownKeys(findings);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('pages[0].regions[0].components[0].properties.titel');
    expect(f.where).toBe('page "probe_page" · page:header');
    // ⚠️ The rename PHRASING moved at #4001 batch A and the assertion follows
    // the fact rather than the wording: a strip-mode shape got the walker's
    // `Did you mean \`title\`?`, a `strictObject` gets its error map's
    // `Did you mean \`titel\` → \`title\`?` — which echoes the offending
    // spelling as well as the fix. Asserted as both spellings present, so this
    // pin measures the diagnostic's content rather than which of the two
    // channels produced it.
    expect(f.message).toContain('`titel`');
    expect(f.message).toContain('`title`');
    expect(f.message).toContain('Did you mean');
  });

  it('is silent on a fully declared props bag', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:header', properties: { title: 'T', subtitle: 'S', breadcrumb: true } },
        {
          type: 'record:related_list',
          properties: { objectName: 'task', relationshipField: 'project_id', limit: 5 },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('walks components nested inside `properties` (tabs items → children)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'page:tabs',
          properties: {
            items: [
              {
                label: 'Detail',
                children: [{ type: 'record:highlights', properties: { fields: ['status'], layuot: 'vertical' } }],
              },
            ],
          },
        },
      ]),
    );
    expect(unknownKeys(findings).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.items[0].children[0].properties.layuot',
    ]);
  });

  it('skips a page whose components are a derived cache of authored `source`', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:header', properties: { titel: 'typo' } }], { kind: 'react', source: 'x' }),
    );
    expect(findings).toEqual([]);
  });
});

/**
 * The second layer, and why it needs its own pins (#5607's correction).
 *
 * `readonly` is not a key on `RecordHighlightsProps`. It lives one level down,
 * on the OBJECT ARM of the `RecordHighlightsField` union that `fields[]` holds
 * — and the authorable-surface walk is strictly one level deep, so it never
 * collects it. #5176 declared the key precisely because objectui's HeaderHighlight
 * gate already honours it; a gate that could not see layer 2 would have gone on
 * reporting it as undeclared and told authors to delete a live key.
 *
 * Both directions are pinned, because only the pair proves the walk descends:
 * the declared spelling must stay SILENT (or the gate over-reports a live key)
 * and a near-miss must be REPORTED (or the silence is just the walk stopping at
 * `fields`, which passes for the wrong reason).
 */
describe('validateComponentProps — the second layer (union arm below an array)', () => {
  it('accepts `readonly` on a highlights field object (#5176) — both verdicts clean', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'record:highlights',
          properties: { fields: ['owner', { name: 'status', label: 'Status', readonly: true }] },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('reports a near-miss of it (`readOnly`) at layer 2, naming the declared spelling', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'record:highlights', properties: { fields: [{ name: 'status', readOnly: true }] } },
      ]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    expect(unknownKeys(findings)[0].path).toBe(
      'pages[0].regions[0].components[0].properties.fields.0.readOnly',
    );
    // Same phrasing move as above (#4001 batch A) — content, not wording.
    expect(unknownKeys(findings)[0].message).toContain('`readOnly`');
    expect(unknownKeys(findings)[0].message).toContain('`readonly`');
    expect(unknownKeys(findings)[0].message).toContain('Did you mean');
  });

  it('leaves a bare string field name alone (the union\'s other arm)', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'record:highlights', properties: { fields: ['status'] } }]),
    );
    expect(findings).toEqual([]);
  });
});

describe('validateComponentProps — value verdicts', () => {
  it('reports a wrongly-typed prop and echoes what was written', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'record:related_list',
          properties: { objectName: 'task', relationshipField: 'p', limit: 'five' },
        },
      ]),
    );
    expect(invalid(findings)).toHaveLength(1);
    expect(invalid(findings)[0].severity).toBe('warning');
    expect(invalid(findings)[0].path).toBe('pages[0].regions[0].components[0].properties.limit');
    expect(invalid(findings)[0].message).toContain('expected number, received string');
  });

  it('reports a missing required prop', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'record:related_list', properties: { objectName: 'task' } }]),
    );
    expect(invalid(findings).map((f) => f.path)).toContain(
      'pages[0].regions[0].components[0].properties.relationshipField',
    );
  });

  /**
   * #7702 — `PageHeaderProps.title` used to be required while the platform's
   * own synthesizer (objectui `buildDefaultHeader`) emits every seeded
   * `page:header` with NO `title` at all: `{ type: 'page:header', recordChrome
   * }`. `validateComponentProps` (this rule) would therefore flag the
   * platform's own default header as `component-props-invalid` on every
   * synthesized record page. Maintainer ruling 2026-08-11: `title` is
   * optional. This pins the exact synthesized shape as clean — no `invalid`
   * finding for a missing `title`, ever.
   */
  it('does not flag the synthesized page:header (no title) as invalid (#7702)', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:header', properties: { recordChrome: true } }]),
    );
    expect(
      invalid(findings).filter((f) => f.path.endsWith('.properties.title')),
    ).toEqual([]);
    expect(findings).toEqual([]);
  });

  /**
   * `ElementDataSourceSchema` is the component-node binding that "overrides
   * page-level object context", and objectui's element renderers read it FIRST
   * (`ds.object ?? props.object`). A component that binds through it has not
   * omitted the flat shorthand — so reporting the props schema's required
   * `object` here would be a WRONG verdict, not a strict one.
   */
  it('does not report the required `object` prop when `dataSource` supplies it', () => {
    const withDataSource = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          id: 'picker',
          dataSource: { object: 'project', limit: 50 },
          properties: { labelField: 'name' },
        },
      ]),
    );
    expect(withDataSource).toEqual([]);

    // …and still reports it when nothing supplies it (or the suppression above
    // would be indistinguishable from the rule never looking).
    const without = validateComponentProps(
      stackWith([{ type: 'element:record_picker', properties: { labelField: 'name' } }]),
    );
    expect(invalid(without).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.object',
    ]);
  });

  /**
   * #5775 — the retirement's author-facing channel. `displayField` was the
   * picker's REQUIRED prop and no renderer ever read it, so the tombstone's
   * prescription has to reach whoever is still writing it. It arrives through
   * the `safeParse` half of this rule (a `never` type is a value verdict, not
   * an unknown key), carrying the rename verbatim.
   */
  it('surfaces the retired `displayField` prescription (#5775)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          properties: { object: 'project', displayField: 'name' },
        },
      ]),
    );
    const retired = invalid(findings).filter((f) => f.path.endsWith('.displayField'));
    expect(retired).toHaveLength(1);
    expect(retired[0].severity).toBe('warning');
    expect(retired[0].message).toMatch(/removed in @objectstack\/spec 17\.0\.0[\s\S]*`labelField`/);
  });

  /**
   * The showcase page that made #5775 necessary: it authors the shape the
   * renderer serves, and the gate used to report it twice over — an undeclared
   * `labelField`/`label` and a missing required `displayField`. It is clean now.
   */
  it('reports nothing on the showcase picker (page-variables.page.ts:59)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          id: 'project_picker',
          dataSource: { object: 'showcase_project', limit: 50 },
          properties: { label: 'Project', labelField: 'name', placeholder: 'Choose a project…' },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  /**
   * #6276 — the #5068 worklist entry #5775's key-by-key ruling left behind.
   * The picker's renderer reads FOUR keys through one `ds.<k> ?? props.<k>`
   * pattern; two of the flat spellings were declared and two were not, so this
   * gate reported `sort`/`limit` as undeclared while the renderer honoured
   * them. Both halves of the rule are asserted, because they fail differently:
   * the key must stop being an unknown-key finding, and its VALUE must now be
   * judged (before the declaration a wrong `limit` was stripped in silence).
   */
  it('reports nothing on the flat `sort` / `limit` shorthands the picker honours (#6276)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          id: 'project_picker',
          properties: {
            object: 'showcase_project',
            labelField: 'name',
            sort: [{ field: 'created_at', order: 'desc' }],
            limit: 20,
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('now judges the VALUE of a flat `limit` instead of stripping it (#6276)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          properties: { object: 'showcase_project', limit: 'twenty' },
        },
      ]),
    );
    expect(invalid(findings).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.limit',
    ]);
    expect(invalid(findings)[0].message).toContain('expected number, received string');
  });

  /**
   * The container half of #5775. `page:card` `children` and the three thin
   * containers' `children` were all reported as unknown keys while the
   * renderers rendered exactly them; `record:path` `stages[].terminal` and the
   * tab items' `value`/`count` are the same shape one level down.
   */
  it('reports nothing on the container/child keys the renderers honour (#5775)', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:card', properties: { title: 'Shortcuts', children: [{ type: 'element:text' }] } },
        { type: 'page:section', properties: { children: [{ type: 'element:text' }] } },
        { type: 'page:footer', properties: { children: [{ type: 'element:text' }] } },
        { type: 'page:sidebar', properties: { children: [{ type: 'element:text' }] } },
        {
          type: 'page:tabs',
          properties: { items: [{ label: 'Tasks', value: 'related:task', count: 3, children: [] }] },
        },
        {
          type: 'record:path',
          properties: {
            statusField: 'status',
            stages: [{ value: 'done', label: 'Done', terminal: 'won' }],
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  /**
   * #6776 — the five keys #5775's count missed. Each is read by an objectui
   * renderer and each was reported here as an undeclared key, so objectui's
   * published manifest and this gate disagreed about the same author's page.
   * This is the acceptance test for the declaration half: the shapes that used
   * to warn must now be silent.
   */
  it('reports nothing on the page:header / page:accordion keys the renderers honour (#6776)', () => {
    const findings = validateComponentProps(
      stackWith([
        // objectui `apps/console/src/preview-samples.ts:68` verbatim — the
        // measured warning site, on a non-record page.
        { type: 'page:header', properties: { title: 'Welcome to the CRM', recordChrome: false } },
        { type: 'page:header', properties: { title: 'Lead', showStar: false, showCopyId: false } },
        { type: 'page:accordion', properties: { items: [], variant: 'card' } },
        { type: 'page:tabs', properties: { tabStyle: 'card', items: [] } },
      ]),
    );
    expect(findings).toEqual([]);
  });

  /**
   * The other direction of the same card. `page:tabs.type` is now a tombstone,
   * and a tombstone is REFUSED rather than reported as unknown — so the finding
   * arrives as `component-props-invalid` carrying the rename prescription, not
   * as `component-props-unknown-key` carrying nothing. The conversion that
   * rewrites it is `retiredFromLoadPath`, so it deliberately does NOT run on
   * this normalized input: an already-stored page keeps the old key and the
   * author is told, which is the whole point of the tombstone.
   */
  it('refuses the retired `page:tabs.type` by name, with the prescription (#6776)', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:tabs', properties: { type: 'card', items: [] } }]),
    );
    expect(invalid(findings).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.type',
    ]);
    expect(invalid(findings)[0].message).toContain('tabStyle');
    // Not an unknown key — the schema still declares it, as a tombstone.
    expect(unknownKeys(findings)).toEqual([]);
  });

  /**
   * The routing that keeps this gate whole across a future `strictObject`
   * batch. `AriaPropsSchema` is the one CLOSED shape inside these props (#4001
   * 批 16), so an unknown key under `aria` is refused by the PARSE rather than
   * by the unknown-key walker — which stays silent on a strict node by design,
   * so as not to be a second voice over a loud rejection. Both paths land on
   * one rule id: when the ratchet closes `ComponentPropsMap`'s own 31 sites,
   * coverage moves between the halves without moving out of the author's view.
   */
  it('routes a STRICT node\'s rejection to the unknown-key id (aria, closed at #4001 批 16)', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:header', properties: { title: 'T', aria: { ariaLabel: 'x', ariaLabl: 'typo' } } },
      ]),
    );
    expect(invalid(findings)).toEqual([]);
    expect(unknownKeys(findings)).toHaveLength(1);
    expect(unknownKeys(findings)[0].path).toContain('.aria.ariaLabl');
  });
});

/**
 * `type` is `z.union([PageComponentType, z.string()])` — open by design. The
 * example corpus authors 87 nodes across ten types `ComponentPropsMap` does not
 * carry (`flex`, `grid`, `object-metric`, `object-chart`, `record:line_items`,
 * …): SDUI blocks whose contract lives in objectui's registry and the ADR-0080
 * manifest, not here. Judging them against an absent schema would report every
 * one of them as broken, which is why the skip is a REQUIRED semantic and not
 * leniency (the maintainer's ruling on #5068).
 */
describe('validateComponentProps — unregistered types are skipped', () => {
  // `object-metric` left this list at #7751 — the `object-*` family is
  // registered now. `object-chart` replaces it: deliberately still absent from
  // the map (two-vocabulary problem — see component.zod.ts's object-block
  // section header), so it is the family's own living proof the skip survives.
  it.each(['record:line_items', 'flex', 'object-chart', 'record:quick_actions'])(
    'says nothing about `%s`, whatever its props carry',
    (type) => {
      const findings = validateComponentProps(
        stackWith([{ type, properties: { anything: 1, at: 'all', nested: { deep: true } } }]),
      );
      expect(findings).toEqual([]);
    },
  );
});

/**
 * ── #7751: the gate's dispatch now FINDS the `object-*` family ──────────────
 *
 * No semantic change to this rule — `PROPS_SCHEMAS` is `ComponentPropsMap`, so
 * the new entries are reachable by construction. What must be pinned from THIS
 * side is behaviour through the real door:
 *
 *  1. anti-vacuity — the warning FIRES on the #7750 specimen shape (an
 *     `object-grid` authored with plural `filters`), with the rename named;
 *  2. the clean-corpus control — the showcase pages' actual authored nodes
 *     (copied, not imported) stay finding-free, so registering the family did
 *     not turn working pages red.
 */
describe('validateComponentProps — object-* blocks are dispatched (#7751)', () => {
  it('FIRES on the #7750 specimen: object-grid authored with plural `filters`', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'object-grid',
        properties: {
          objectName: 'showcase_task',
          columns: ['title', 'project', 'status', 'priority', 'due_date'],
          filters: [['owner_id', '=', '{current_user_id}']],
        },
      }]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    const [f] = unknownKeys(findings);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('pages[0].regions[0].components[0].properties.filters');
    expect(f.where).toBe('page "probe_page" · object-grid');
    expect(f.message).toContain('`filters`');
    expect(f.message).toContain('Did you mean `filters` → `filter`?');
    // Warning tier only — the error upgrade stays gated on the #5068
    // inventory; this card did not move that gate (ruling 2026-08-12).
    expect(invalid(findings)).toEqual([]);
  });

  it('stays SILENT on the corrected #7750 node and the corpus metric shapes (clean-corpus control)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'object-grid',
          properties: {
            objectName: 'showcase_task',
            columns: ['title', 'project', 'status', 'priority', 'due_date'],
            filter: [['owner_id', '=', '{current_user_id}']],
          },
        },
        {
          type: 'object-metric',
          properties: { objectName: 'showcase_task', label: 'Open Tasks', icon: 'list-checks', colorVariant: 'blue', description: 'not done', aggregate: { field: 'id', function: 'count' }, filter: { status: { $ne: 'done' } } },
        },
        {
          type: 'object-metric',
          properties: { objectName: 'showcase_project', label: 'Projects', colorVariant: 'purple', variant: 'bare', aggregate: { field: 'id', function: 'count' }, format: '0,0' },
        },
        {
          type: 'object-form',
          properties: {
            objectName: 'showcase_project',
            mode: 'create',
            formType: 'wizard',
            showStepIndicator: true,
            title: 'Create a Project',
            description: 'A three-step wizard.',
            sections: [{ label: 'Basics', description: 'Name it.', fields: ['name'] }],
            submitBehavior: { kind: 'thank-you', title: 'Project created', message: 'Ready.' },
          },
        },
        {
          type: 'object-master-detail-form',
          properties: {
            objectName: 'showcase_project',
            mode: 'create',
            formType: 'simple',
            submitText: 'Create Project + Tasks',
            fields: ['name', 'account'],
            details: [{ title: 'Tasks', childObject: 'showcase_task', addLabel: 'Add task' }],
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("answers the designer's dead `groupField` with the `groupBy` the board reads", () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'object-kanban', properties: { objectName: 'task', groupField: 'status' } }]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    expect(unknownKeys(findings)[0].message).toContain('Did you mean `groupField` → `groupBy`?');
  });
});

/**
 * Why the registry entry reads the NORMALIZED tier.
 *
 * The props bag survives the Zod parse unchanged (`z.record(z.string(),
 * z.unknown())`), so the two tiers carry identical props and the choice looks
 * free. It is not: the ADR-0087 D2 conversion layer runs INSIDE
 * `normalizeStackInput`, and `page-header-subtitle-alias` rewrites
 * `properties.description` → `subtitle` on header nodes. Reading the raw
 * authored input would report a key the conversion layer has already fixed —
 * the rule contradicting a declared conversion, which is exactly the
 * second-de-facto-contract shape Prime Directive #12 forbids.
 */
describe('validateComponentProps — reads the post-conversion (normalized) tier', () => {
  const authored = stackWith([
    { type: 'page:header', properties: { title: 'Lead', description: 'All open leads' } },
  ]);

  it('says nothing about a key the ADR-0087 conversion layer canonicalizes', () => {
    expect(validateComponentProps(normalizeStackInput(authored))).toEqual([]);
  });

  it('WOULD report it pre-conversion — which is why the tier is not free', () => {
    const raw = validateComponentProps(authored);
    expect(unknownKeys(raw).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.description',
    ]);
  });
});

describe('validateComponentProps — wiring', () => {
  it('is registered as an advisory rule on all three authoring commands', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateComponentProps');
    expect(entry).toBeDefined();
    expect(entry?.tier).toBe('advisory');
    expect([...(entry?.commands ?? [])].sort()).toEqual(['build', 'lint', 'validate']);
  });

  it('reaches the shared authoring pipeline — the run that reported nothing before #5068', () => {
    const findings = runAuthoringRules('validate', {
      normalized: stackWith([{ type: 'page:header', properties: { title: 'T', titel: 'typo' } }]) as never,
    });
    const mine = findings.filter((f) => f.rule.startsWith('component-props'));
    expect(mine).toHaveLength(1);
    expect(mine[0].severity).toBe('warning');
    expect(mine[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
  });
});

/**
 * #4001 batch A closed all 31 `ComponentPropsMap` shapes, including two UNION
 * ARMS. An arm's rejection travels a different road out of zod than an object's,
 * and this block pins both that it arrives and that it is not over-claimed.
 */
describe('validateComponentProps — a STRICT union arm reports as an unknown key (#4001 batch A)', () => {
  const highlights = (fields: unknown) =>
    validateComponentProps(stackWith([{ type: 'record:highlights', properties: { fields } }]));

  it('routes an arm-level `unrecognized_keys` to the unknown-key rule, with the surface and the rename intact', () => {
    const findings = highlights([{ name: 'status', labell: 'Status' }]);
    expect(findings).toHaveLength(1);
    // The rule id is the point: a closed arm and a closed object are ONE
    // diagnostic for the author, not two with different hints.
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.fields.0.labell');
    // Zod collapses arm failures into one `invalid_union` whose own message is
    // the bare "Invalid input" — everything below survives only because
    // `zod-issue-format.ts` unpacks the arm. Delete that unpacking and these
    // three assertions go red while `packages/spec`'s own suite stays green,
    // which is exactly the blind spot they exist for.
    expect(findings[0].message).toContain('record:highlights` field');
    expect(findings[0].message).toContain('`labell`');
    expect(findings[0].message).toContain('label');
    expect(findings[0].message).not.toContain('Invalid input —');
  });

  it('does NOT claim a rename when the author may have meant another arm', () => {
    // The bare-string arm is legal here, so a value that fails BOTH arms for
    // key reasons cannot be attributed to one of them. It falls through to the
    // value verdict, which prints every arm's own message rather than guessing.
    const findings = highlights([{ labell: 'Status' }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_INVALID);
    // Still legible — the arms are unpacked, just not attributed.
    expect(findings[0].message).toContain('no accepted form matched');
  });

  it('positive control — the string arm and the full object arm both stay silent', () => {
    expect(highlights(['status'])).toEqual([]);
    expect(highlights([{ name: 'status', label: 'Status', readonly: true }])).toEqual([]);
  });
});

/**
 * #8691 — the rail's row exists, so the gate's dispatch reaches it.
 *
 * The pre-fix state this pins against: `record:reference_rail` had no
 * `ComponentPropsMap` row, so the walker's unregistered-type skip swallowed the
 * whole props bag — the issue's planted `filter` produced ZERO findings from
 * validate/build while `record:related_list` keys in the same file were loudly
 * reported. Remove the map row and every assertion in the first test here goes
 * back to that silence (the reverse verification the issue ran on a real app).
 */
describe('validateComponentProps — record:reference_rail is dispatched (#8691)', () => {
  it('reports the issue\'s planted entry `filter`, loudly, through the same rule as its siblings', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:reference_rail',
        properties: {
          entries: [{
            objectName: 'task',
            relationshipField: 'project_id',
            filter: [{ field: 'status', op: 'neq', value: 'completed' }],
          }],
        },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].where).toBe('page "probe_page" · record:reference_rail');
    expect(findings[0].message).toContain('`filter`');
    // The prescription names where `filter` IS real, so the author is routed
    // to the component that delivers it rather than left with a bare refusal.
    expect(findings[0].message).toContain('record:related_list');
  });

  it('stays silent on the shape the renderer actually reads', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:reference_rail',
        properties: {
          entries: [
            { objectName: 'task', relationshipField: 'project_id', title: 'Tasks', limit: 3, displayField: 'subject' },
          ],
          hideEmpty: false,
        },
      }]),
    );
    expect(findings).toEqual([]);
  });
});
