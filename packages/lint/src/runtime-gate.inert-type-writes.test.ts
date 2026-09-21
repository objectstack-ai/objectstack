// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19474 — the six write doors that dispatched NOTHING, under the ADR-0049
 * ruling 「declared ⇒ honoured; not honourable ⇒ retired」.
 *
 * ## The state this closes
 *
 * `DEFAULT_METADATA_TYPE_REGISTRY` declares `action`, `hook`, `report`,
 * `skill`, `email_template` and `mapping` with `allowRuntimeCreate: true` —
 * Studio, REST `/meta` and an MCP/AI author may all mint one at runtime.
 * Measured on `origin/main` before this card: no rule declared any of the six
 * in `runtimeTypes`, so the gate filtered them out before it ever consulted
 * `TYPE_TO_STACK_KEY` and a write of any of them built no snapshot and ran no
 * rule at all. `action` and `hook` already HAD their stack-key rows; the two
 * absences were consistent rather than contradictory, which is exactly why CI
 * was green and the declaration was hollow anyway.
 *
 * ## Why this file exists rather than a diff
 *
 * The ruling carried its own NOT MEASURED item forward unchanged — 「whether a
 * wired rule fires on a real write」 — and made acceptance behavioural: a
 * `surfaces` / `runtimeTypes` field that merely changed is not the deliverable.
 * So every type below has BOTH legs through the real door: a write the wired
 * rule must judge IS judged, and a good write of the same type passes. The
 * `seed: 'data'` note in `runtime-gate.ts` records what a file like this
 * refuses to let happen — a mapping onto a collection nothing reads keeps every
 * gate green and reports `rulesRun` while running on nothing.
 *
 * ## ⚠️ Two of the six are wired-and-SILENT, on purpose, and that is pinned too
 *
 * `email_template` and `mapping` bridge through `lintLivenessProperties`, which
 * is LEDGER-DRIVEN and `continue`s on an empty warn map. Both ledgers carry 0
 * warn keys and the ruling dispatched ⛔ no ledger-population work («the empty
 * warn maps stay empty until a real property needs a row — zero pull, the
 * wiring is the whole deliverable»). So for those two the honest reading is
 * "the rule is dispatched and judges nothing today", and the zero carries a LIT
 * CONTROL on the same instrument in the same process so it can never be
 * confused with a broken dispatch or an unreadable ledger.
 */
import { describe, expect, it } from 'vitest';

import { AUTHORING_RULES } from './authoring-rules.js';
import { lintLivenessProperties } from './lint-liveness-properties.js';
import { REFERENCE_INTEGRITY_RULES } from './reference-integrity-suite.js';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';

/** The six types this card wires, in the ruling's own grouping order. */
const GROUP_A = ['action', 'hook', 'report', 'skill'] as const;
const GROUP_C = ['email_template', 'mapping'] as const;

/**
 * The resolution universe every case is judged against — the two collections a
 * per-write snapshot actually carries, with the field types and dimension names
 * the cases below ask about.
 */
const OBJECTS = [
  {
    name: 'acme_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: {
      status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
      issued_on: { type: 'date', label: 'Issued' },
      total: { type: 'currency', label: 'Total' },
      done: { type: 'boolean', label: 'Done' },
    },
    // An OBJECT-level AI-exposed action. It rides in on `objects`, which is why
    // `action_acme_ping` resolves for a skill write and a stack-level action
    // does not — see the partial-universe reading below.
    actions: [
      {
        name: 'acme_ping',
        label: 'Ping',
        type: 'script',
        target: 'ping',
        ai: { exposed: true, description: 'Ping the invoice.' },
      },
    ],
  },
];

const DATASETS = [
  {
    name: 'acme_invoice_metrics',
    label: 'Invoice Metrics',
    object: 'acme_invoice',
    dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
    measures: [{ name: 'total_sum', label: 'Total', aggregate: 'sum', field: 'total' }],
  },
];

const CONTEXT = { objects: OBJECTS, datasets: DATASETS };

const ruleIds = (findings: readonly { rule: string }[]) => findings.map((f) => f.rule);
const dump = (r: { errors: readonly unknown[]; advisories: readonly unknown[] }) =>
  JSON.stringify({ errors: r.errors, advisories: r.advisories });

// ─────────────────────────────────────────────────────────────────────────────

describe('#19474 — the six doors are declared, mapped and reachable', () => {
  it.each([...GROUP_A, ...GROUP_C])('`%s` dispatches at least one rule and maps to a stack key', (type) => {
    // Three halves, because any one of them alone is the "looks wired,
    // enforces nothing" state: the type is gated, some rule runs for it, and
    // the gate can build a snapshot for it. Without the mapping the gate finds
    // the rules, builds no snapshot and returns clean.
    expect(runtimeGatedTypes()).toContain(type);
    expect(runtimeAuthoringRulesFor(type).length, `no rule declares '${type}'`).toBeGreaterThan(0);
    expect(stackKeyForType(type)).not.toBeNull();
  });

  it('each stack key is the collection the crossed rules actually read', () => {
    // The `seed: 'data'` failure, asked directly: a mapping is only worth
    // anything when it names the key the rule opens on.
    expect(stackKeyForType('action')).toBe('actions');
    expect(stackKeyForType('hook')).toBe('hooks');
    expect(stackKeyForType('report')).toBe('reports');
    expect(stackKeyForType('skill')).toBe('skills');
    expect(stackKeyForType('email_template')).toBe('emailTemplates');
    expect(stackKeyForType('mapping')).toBe('mappings');
  });

  it('the written item really lands in that collection', () => {
    // Proven through the door rather than off the table: a finding pathed
    // `reports[0]…` can only come from a snapshot whose `reports` holds this
    // write.
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: { name: 'acme_report', label: 'R', dataset: 'no_such_dataset' },
      context: CONTEXT,
    });
    expect(result.errors.map((f) => f.path)).toContain('reports[0].dataset');
  });
});

// ─── Group A · `action` ──────────────────────────────────────────────────────

describe('#19474 — the `action` door (validateStackExpressions)', () => {
  const action = (over: Record<string, unknown> = {}) => ({
    name: 'acme_close',
    label: 'Close',
    objectName: 'acme_invoice',
    type: 'script',
    target: 'close',
    ...over,
  });

  it('⭐ LIT — an action whose `visible` CEL does not parse is REFUSED', () => {
    const result = runRuntimeAuthoringRules({
      type: 'action',
      item: action({ visible: 'record.status ==' }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(ruleIds(result.errors), dump(result)).toContain('expression-invalid');
    expect(result.errors[0]?.where).toContain("action 'acme_close'");
  });

  it('⭐ LIT — an action bound to an object, naming a field it has not got, is REFUSED', () => {
    // The field-resolution half, which only happens because the snapshot
    // carries `objects`. `objectName` is the canonical binding key; the `object`
    // spelling is an alias the strict schema renames one layer earlier, so it
    // never reaches this gate.
    const result = runRuntimeAuthoringRules({
      type: 'action',
      item: action({ visible: 'record.no_such_field == true' }),
      context: CONTEXT,
    });

    expect(ruleIds(result.errors), dump(result)).toContain('expression-invalid');
    expect(result.errors[0]?.message).toContain('no_such_field');
  });

  it('⭐ CONTROL — a good action publishes clean', () => {
    const result = runRuntimeAuthoringRules({
      type: 'action',
      item: action({ visible: "record.status == 'open'" }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⭐ CONTROL — the shipped corpus action stays publishable', () => {
    // `examples/app-crm` `crm_convert_lead`, verbatim, judged against its own
    // object. A refusal widening whose population was never measured is how a
    // door stops being usable.
    const result = runRuntimeAuthoringRules({
      type: 'action',
      item: {
        name: 'crm_convert_lead',
        label: 'Convert Lead',
        objectName: 'crm_lead',
        icon: 'ArrowRightCircle',
        locations: ['list_item', 'record_header', 'record_more'],
        type: 'flow',
        target: 'crm_convert_lead_wizard',
        refreshAfter: false,
        visible: { dialect: 'cel', source: 'has(record.status) && record.status != "converted"' },
        recordIdParam: 'recordId',
      },
      context: {
        objects: [
          {
            name: 'crm_lead',
            label: 'Lead',
            sharingModel: 'private',
            fields: { status: { type: 'select', label: 'Status' } },
          },
        ],
      },
    });

    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });
});

// ─── Group A · `hook` ────────────────────────────────────────────────────────

describe('#19474 — the `hook` door (validateStackExpressions)', () => {
  const hook = (over: Record<string, unknown> = {}) => ({
    name: 'acme_stamp',
    object: 'acme_invoice',
    events: ['beforeInsert'],
    ...over,
  });

  it('⭐ LIT — a hook whose `condition` names a field the object has not got is REFUSED', () => {
    const result = runRuntimeAuthoringRules({
      type: 'hook',
      item: hook({ condition: 'record.no_such_field == true' }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(ruleIds(result.errors), dump(result)).toContain('expression-invalid');
    expect(result.errors[0]?.message).toContain('no_such_field');
    expect(result.errors[0]?.where).toContain("hook 'acme_stamp'");
  });

  it('⭐ LIT — a hook whose `condition` does not parse is REFUSED', () => {
    const result = runRuntimeAuthoringRules({
      type: 'hook',
      item: hook({ condition: 'record.done ==' }),
      context: CONTEXT,
    });

    expect(ruleIds(result.errors), dump(result)).toContain('expression-invalid');
  });

  it('⭐ CONTROL — a good hook publishes clean', () => {
    const result = runRuntimeAuthoringRules({
      type: 'hook',
      item: hook({ condition: "record.status == 'open'" }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⭐ CONTROL — the shipped corpus hook stays publishable', () => {
    // `examples/app-showcase` `showcase_audit_task_completion`, verbatim.
    const result = runRuntimeAuthoringRules({
      type: 'hook',
      item: {
        name: 'showcase_audit_task_completion',
        object: 'showcase_task',
        events: ['afterUpdate'],
        condition: { dialect: 'cel', source: 'previous.done != true && record.done == true' },
      },
      context: {
        objects: [
          {
            name: 'showcase_task',
            label: 'Task',
            sharingModel: 'private',
            fields: { done: { type: 'boolean', label: 'Done' } },
          },
        ],
      },
    });

    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });
});

// ─── Group A · `report` ──────────────────────────────────────────────────────

describe('#19474 — the `report` door (three rules, one document)', () => {
  const report = (over: Record<string, unknown> = {}) => ({
    name: 'acme_report',
    label: 'Invoice Report',
    type: 'summary',
    dataset: 'acme_invoice_metrics',
    rows: ['status'],
    values: ['total_sum'],
    ...over,
  });

  it('⭐ LIT — a report binding a dataset that does not exist is REFUSED', () => {
    // `validateChartBindings`, the suite member crossed for `report`. It
    // resolves against `stack.datasets`, the collection the snapshot carries.
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: report({ dataset: 'no_such_dataset' }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateReferenceIntegrity');
    expect(ruleIds(result.errors), dump(result)).toContain('chart-dataset-unknown');
  });

  it('⭐ LIT — a report grouping by a dimension its dataset does not declare is REFUSED', () => {
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: report({ rows: ['no_such_dimension'] }),
      context: CONTEXT,
    });

    expect(ruleIds(result.errors), dump(result)).toContain('chart-dimension-unknown');
  });

  it('⭐ LIT — a report whose filter is a literal empty combinator is REFUSED', () => {
    // `validateEmptyCombinators`, crossed for `report` TOGETHER with
    // `validatePresetComparands` below (#7220: the two judge the same authored
    // filter literal on the same surface, so they cross or they do not).
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: report({ runtimeFilter: { $and: [] } }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateEmptyCombinators');
    expect(ruleIds(result.errors), dump(result)).toContain('filter-empty-combinator');
  });

  it('⭐ LIT — a report filtering by a dashboard date PRESET name is REFUSED', () => {
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: report({ runtimeFilter: { issued_on: { $gt: 'last_30_days' } } }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validatePresetComparands');
    expect(ruleIds(result.errors), dump(result)).toContain('filter-preset-comparand');
  });

  it('⭐ CONTROL — a good report publishes clean', () => {
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: report({ runtimeFilter: { status: 'open' } }),
      context: CONTEXT,
    });

    expect(result.rulesRun).toEqual(
      expect.arrayContaining([
        'validatePresetComparands',
        'validateEmptyCombinators',
        'validateReferenceIntegrity',
      ]),
    );
    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⭐ CONTROL — the shipped corpus report stays publishable', () => {
    // `examples/app-todo` `completed_tasks` with its own `task_metrics`
    // dataset, verbatim — a filter-carrying member of the measured population,
    // so this control is not vacuous for the two filter rules either.
    const result = runRuntimeAuthoringRules({
      type: 'report',
      item: {
        name: 'completed_tasks',
        label: 'Completed Tasks',
        description: 'All completed tasks with time tracking',
        type: 'summary',
        dataset: 'task_metrics',
        rows: ['category'],
        values: ['est_hours', 'actual_hours'],
        runtimeFilter: { status: 'completed' },
        drilldown: true,
      },
      context: {
        objects: [
          {
            name: 'todo_task',
            label: 'Task',
            sharingModel: 'private',
            fields: {
              status: { type: 'select', label: 'Status' },
              category: { type: 'text', label: 'Category' },
              estimated_hours: { type: 'number', label: 'Est' },
              actual_hours: { type: 'number', label: 'Actual' },
            },
          },
        ],
        datasets: [
          {
            name: 'task_metrics',
            label: 'Task Metrics',
            object: 'todo_task',
            dimensions: [
              { name: 'status', label: 'Status', field: 'status', type: 'string' },
              { name: 'category', label: 'Category', field: 'category', type: 'string' },
            ],
            measures: [
              { name: 'task_count', label: 'Tasks', aggregate: 'count' },
              { name: 'est_hours', label: 'Estimated Hours', aggregate: 'sum', field: 'estimated_hours' },
              { name: 'actual_hours', label: 'Actual Hours', aggregate: 'sum', field: 'actual_hours' },
            ],
          },
        ],
      },
    });

    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });
});

// ─── Group A · `skill` ───────────────────────────────────────────────────────

describe('#19474 — the `skill` door (validateAiToolReferences)', () => {
  const skill = (tools: string[]) => ({
    name: 'acme_skill',
    label: 'Invoice Skill',
    description: 'Answers invoice questions.',
    tools,
  });

  it('⭐ LIT — a skill naming a tool nothing can resolve IS judged (advisory, never a refusal)', () => {
    // The whole reading for this type, stated rather than implied: the rule
    // FIRES on a real write — which is the ruling's own NOT MEASURED item —
    // and it fires at `warning`, so it advises and can never block a publish.
    const result = runRuntimeAuthoringRules({
      type: 'skill',
      item: skill(['forecast_revenue']),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateReferenceIntegrity');
    expect(result.errors, 'this member is warning-tier throughout').toEqual([]);
    expect(ruleIds(result.advisories), dump(result)).toContain('ai-skill-tool-unresolved');
    expect(result.advisories[0]?.path).toBe('skills[0].tools[0]');
  });

  it('⭐ CONTROL — a skill naming a PLATFORM tool publishes clean', () => {
    const result = runRuntimeAuthoringRules({
      type: 'skill',
      item: skill(['query_data']),
      context: CONTEXT,
    });

    expect(result.rulesRun).toContain('validateReferenceIntegrity');
    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⭐ CONTROL — a skill naming an OBJECT-level action tool publishes clean', () => {
    // The action family resolves here because the materialised universe is
    // built from `stack.actions` ∪ every object's `actions`, and `objects` is
    // a collection the snapshot carries.
    const result = runRuntimeAuthoringRules({
      type: 'skill',
      item: skill(['action_acme_ping']),
      context: CONTEXT,
    });

    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⚠️ RECORDED — the tool universe is PARTIAL at this door, and this is what that costs', () => {
    // Not a wish: the measured shape of the crossing. `collectToolUniverse`
    // unions the platform registry ∪ `stack.tools` ∪ the action family from
    // `stack.actions` and every object's `actions`. A per-write snapshot
    // carries neither `tools` nor `actions`, so a skill naming a STACK-LEVEL
    // declared tool reads as unresolved at this door while it is clean on the
    // whole stack.
    //
    // Pinned in BOTH directions so it can only change deliberately: the same
    // skill, same rule, judged once at the door and once on a stack that
    // carries the collection.
    const atTheDoor = runRuntimeAuthoringRules({
      type: 'skill',
      item: skill(['acme_declared_tool']),
      context: CONTEXT,
    });
    expect(
      ruleIds(atTheDoor.advisories),
      'the door cannot see `stack.tools`, so it advises — ADR-0109 says the default authoring '
        + 'path declares no tool records, and this member can never refuse, which is what bounds it',
    ).toContain('ai-skill-tool-unresolved');

    const onTheWholeStack = REFERENCE_INTEGRITY_RULES.find((r) => r.name === 'validateAiToolReferences')!
      .run({ skills: [skill(['acme_declared_tool'])], tools: [{ name: 'acme_declared_tool' }] }, {});
    expect(
      onTheWholeStack,
      'lit control on the same rule: given the collection, the same reference resolves',
    ).toEqual([]);
  });
});

// ─── Group C · `email_template` and `mapping` ────────────────────────────────

describe('#19474 — group C: wired, dispatched, and silent by ledger (email_template · mapping)', () => {
  it.each(GROUP_C)('`%s` writes DO dispatch the ledger rule', (type) => {
    const item = type === 'email_template'
      ? { name: 'acme_welcome', label: 'Welcome', subject: 'Hi', bodyHtml: '<p>Hi</p>' }
      : { name: 'acme_feed', label: 'Feed', sourceFormat: 'csv', targetObject: 'acme_invoice' };
    const result = runRuntimeAuthoringRules({ type, item, context: CONTEXT });

    expect(
      result.rulesRun,
      `'${type}' must reach lintLivenessProperties — the wiring is the deliverable`,
    ).toContain('lintLivenessProperties');
  });

  it.each(GROUP_C)('`%s` — and the rule judges NOTHING today, because its ledger warns on nothing', (type) => {
    // ⚠️ The report's first reading for these two, pinned rather than
    // remembered. The ruling dispatched the wiring and ⛔ no ledger population,
    // so this silence is the ruled end state. The day a property earns an
    // `authorWarn` row the door lights up with no second edit — which is what
    // the dispatch pin above is for.
    const item = type === 'email_template'
      ? { name: 'acme_welcome', label: 'Welcome', subject: 'Hi', bodyHtml: '<p>Hi</p>', category: 'workflow' }
      : { name: 'acme_feed', label: 'Feed', sourceFormat: 'csv', targetObject: 'acme_invoice', mode: 'upsert' };
    const result = runRuntimeAuthoringRules({ type, item, context: CONTEXT });

    expect(result.errors, dump(result)).toEqual([]);
    expect(result.advisories, dump(result)).toEqual([]);
  });

  it('⭐ LIT CONTROL — the same instrument, in this same process, DOES fire on a ledger that warns', () => {
    // Without this the two zeros above would be unreadable: a silent rule and
    // an unresolvable ledger directory look identical from the outside. This
    // asks `lintLivenessProperties` the one question whose answer is non-empty
    // today (`object.externalSharingModel` is `authorWarn` in tree), so the
    // zeros are attributable to the empty warn maps and to nothing else.
    const findings = lintLivenessProperties({
      objects: [{ name: 'acme_invoice', externalSharingModel: 'read' }],
    });

    expect(
      findings.map((f) => f.where + ' ' + f.message).join(' | '),
      'the ledger directory resolves and the rule produces findings here',
    ).toContain('externalSharingModel');
  });

  it('⭐ CONTROL — the shipped corpus email template and mapping stay publishable', () => {
    // `examples/app-showcase`, verbatim — the whole authored population of
    // both types across the example apps (1 each).
    const email = runRuntimeAuthoringRules({
      type: 'email_template',
      item: {
        name: 'showcase_task_done_email',
        label: 'Task Done Notification',
        category: 'workflow',
        locale: 'en-US',
        subject: 'Task done: {{title}}',
        bodyHtml: '<p>The task <strong>{{title}}</strong> was marked done.</p>',
        bodyText: 'The task {{title}} was marked done.',
        variables: [{ name: 'title', type: 'string', required: true, description: 'Task title' }],
        active: true,
        isSystem: false,
      },
      context: CONTEXT,
    });
    expect(email.errors, dump(email)).toEqual([]);
    expect(email.advisories, dump(email)).toEqual([]);

    const mapping = runRuntimeAuthoringRules({
      type: 'mapping',
      item: {
        name: 'showcase_inquiry_feed',
        label: 'Inquiry feed (marketing CSV)',
        sourceFormat: 'csv',
        targetObject: 'showcase_inquiry',
        fieldMapping: [
          { source: 'Full Name', target: 'name', transform: 'none' },
          { source: 'E-mail', target: 'email', transform: 'none' },
        ],
        mode: 'upsert',
        upsertKey: ['email'],
      },
      context: CONTEXT,
    });
    expect(mapping.errors, dump(mapping)).toEqual([]);
    expect(mapping.advisories, dump(mapping)).toEqual([]);
  });
});

// ─── The fences ──────────────────────────────────────────────────────────────

describe('#19474 — DARK: what the six crossings did NOT widen', () => {
  it('`action` and `hook` writes do NOT dispatch the reference-integrity suite', () => {
    // The one crossing that would turn `runtime-lazy-deps.test.ts` tier 1
    // («typescript / sucrase load NEVER») from a standing fact into a red: the
    // suite carries the four body-writes members, and an action/hook write is
    // exactly the snapshot that WOULD carry an authored JS body for them to
    // parse. Their bridge is `validateStackExpressions`, which judges CEL.
    for (const type of ['action', 'hook'] as const) {
      expect(
        runtimeAuthoringRulesFor(type).map((r) => r.name),
        `'${type}' writes must not reach the suite — the body-writes members parse JS`,
      ).not.toContain('validateReferenceIntegrity');
    }
  });

  it('a `skill` write reaches exactly ONE suite member, and a `report` write exactly one', () => {
    // The entry-level `runtimeTypes` says which WRITES dispatch the suite; the
    // per-member `runtimeTypes` says which MEMBERS judge that snapshot. Asked
    // against the real table so a member widened without this file noticing
    // fails here.
    const membersFor = (type: string) =>
      REFERENCE_INTEGRITY_RULES.filter((m) => (m.runtimeTypes ?? ['flow']).includes(type)).map((m) => m.name);

    expect(membersFor('skill')).toEqual(['validateAiToolReferences']);
    expect(membersFor('report')).toEqual(['validateChartBindings']);
  });

  it('the ledger rule reaches ONLY the two types group C names', () => {
    // `RUNTIME_OBJECT_ADVISORY_VOLUME` still holds for `object` — that reason
    // is about ~8 advisories per object write rendered in Studio, and this
    // crossing does not spend it.
    const gated = runtimeGatedTypes().filter((t) =>
      runtimeAuthoringRulesFor(t).some((r) => r.name === 'lintLivenessProperties'));
    expect(gated.sort()).toEqual(['email_template', 'mapping']);
  });

  it('crossing these six widened no OTHER type s roster', () => {
    // The card is six metadata types. `translation` is the standing
    // ungated control — its own ruling group (B) reads first.
    expect(runtimeAuthoringRulesFor('translation')).toEqual([]);
    expect(runtimeAuthoringRulesFor('doc')).toEqual([]);
    expect(runtimeAuthoringRulesFor('external_catalog')).toEqual([]);
    expect(runtimeAuthoringRulesFor('tool')).toEqual([]);
  });

  it('every crossed entry still answers the surface question as data', () => {
    // The #4409 / #4463 mechanism, re-asked on exactly the entries this card
    // edited: a rule on the runtime surface declares its types, and a rule off
    // it records why. Silence is what both issues fixed.
    const CROSSED = [
      'validateStackExpressions',
      'validatePresetComparands',
      'validateEmptyCombinators',
      'validateReferenceIntegrity',
      'lintLivenessProperties',
    ];
    for (const name of CROSSED) {
      const entry = AUTHORING_RULES.find((r) => r.name === name);
      expect(entry, `${name} left AUTHORING_RULES — re-point this pin or retire it`).toBeDefined();
      expect(entry!.surfaces).toContain('runtime-publish');
      expect((entry!.runtimeTypes ?? []).length, `${name} declares no runtime types`).toBeGreaterThan(0);
      expect(entry!.surfaceReason, `${name} is on the runtime surface, so it owes no surfaceReason`)
        .toBeUndefined();
    }
  });
});
