// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_BODY_NOT_LONG_TEXT,
  AI_CONTEXT_FIELD_UNKNOWN,
  AI_CONTEXT_FIELD_UNPROVISIONED,
  AI_CONTEXT_OBJECT_UNKNOWN,
  AI_CONTEXT_RELATED_LINK_UNKNOWN,
  AI_CONTEXT_SORT_FIELD_UNSORTABLE,
  validateAiContext,
} from './validate-ai-context.js';
import { explainRule } from './rule-explanations.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor, stackKeyForType } from './runtime-gate.js';

const objects = [
  {
    name: 'policy',
    fields: {
      title: { type: 'text' },
      status: { type: 'select' },
      content: { type: 'markdown' },
      owner: { type: 'lookup', reference: 'account' },
    },
  },
  {
    name: 'policy_revision',
    fields: { version: { type: 'text' }, policy: { type: 'lookup', reference: 'policy' }, rank: { type: 'number', sortable: false } },
  },
  {
    name: 'policy_link',
    fields: {
      from_policy: { type: 'lookup', reference: 'policy' },
      to_policy: { type: 'lookup', reference: 'policy' },
    },
  },
  { name: 'account', fields: { name: { type: 'text' } } },
];

const pack = (over: Record<string, unknown> = {}) => ({
  name: 'policy_document',
  label: 'Policy document',
  object: 'policy',
  fields: ['title', 'status', 'owner'],
  related: [{ object: 'policy_revision', fields: ['version'] }],
  body: { field: 'content' },
  ...over,
});

const rulesOf = (stack: Record<string, unknown>) => validateAiContext(stack).map((f) => [f.rule, f.path]);

describe('validateAiContext — ADR-0160 D1 author defects', () => {
  it('a pack that names only what the stack defines is clean', () => {
    expect(validateAiContext({ objects, aiContexts: [pack()] })).toEqual([]);
  });

  it('reports a field the object does not define, in fields, related fields and body', () => {
    const stack = {
      objects,
      aiContexts: [pack({
        fields: ['title', 'titel'],
        related: [{ object: 'policy_revision', fields: ['versoin'] }],
        body: { field: 'contnet' },
      })],
    };
    expect(rulesOf(stack)).toEqual([
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].fields[1]'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].body.field'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].fields[0]'],
    ]);
  });

  it('reports a where or orderBy field the child does not define (ADR-0160 second amendment): the list is left out', () => {
    const stack = {
      objects,
      aiContexts: [pack({
        related: [{
          object: 'policy_revision',
          fields: ['version'],
          where: { $or: [{ version: 'v1' }, { is_curent: true }] },
          orderBy: [{ field: 'version', order: 'asc' }, { field: 'sortno', order: 'desc' }],
          limit: 5,
        }],
      })],
    };
    expect(rulesOf(stack)).toEqual([
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].where'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].orderBy[1].field'],
    ]);
    const [whereFinding] = validateAiContext(stack);
    expect(whereFinding.message).toContain("'is_curent'");
    expect(whereFinding.message).toContain('left out');
    // Control: the same keys on fields the child defines are clean.
    expect(rulesOf({
      objects,
      aiContexts: [pack({ related: [{ object: 'policy_revision', where: { version: { $ne: 'v0' } }, orderBy: [{ field: 'version' }] }] })],
    })).toEqual([]);
  });

  it('reports an orderBy field the child does not offer as a sort (sortable: false, a formula): the list is left out', () => {
    const ranked = objects.map((o) => o.name !== 'policy_revision' ? o : {
      ...o,
      fields: {
        ...o.fields,
        score: { type: 'formula', expression: 'rank * 2' },
        seq: { type: 'number' },
      },
    });
    const stack = {
      objects: ranked,
      aiContexts: [pack({
        related: [{
          object: 'policy_revision',
          where: { rank: { $gt: 0 } },
          orderBy: [{ field: 'seq' }, { field: 'rank', order: 'desc' }, { field: 'score' }],
        }],
      })],
    };
    expect(rulesOf(stack)).toEqual([
      [AI_CONTEXT_SORT_FIELD_UNSORTABLE, 'aiContexts[0].related[0].orderBy[1].field'],
      [AI_CONTEXT_SORT_FIELD_UNSORTABLE, 'aiContexts[0].related[0].orderBy[2].field'],
    ]);
    const [declared, formula] = validateAiContext(stack);
    expect(declared.severity).toBe('warning');
    expect(declared.message).toContain("'rank'");
    expect(declared.message).toContain('`sortable: false`');
    expect(declared.message).toContain('left out');
    expect(formula.message).toContain('formula');
    // Control: the same fields in `where` and a sortable order are clean.
    expect(rulesOf({ objects: ranked, aiContexts: [pack({ related: [{ object: 'policy_revision', where: { rank: 1, score: 2 }, orderBy: [{ field: 'seq' }] }] })] }))
      .toEqual([]);
  });

  it('reports an object the stack does not define once, without judging its fields; a sys_ object is not judged', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ object: 'polcy', related: undefined, body: undefined })] })).toEqual([
      [AI_CONTEXT_OBJECT_UNKNOWN, 'aiContexts[0].object'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_revison' }] })] })).toEqual([
      [AI_CONTEXT_OBJECT_UNKNOWN, 'aiContexts[0].related[0].object'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ object: 'sys_user', fields: ['nope'], related: undefined, body: undefined })] })).toEqual([]);
  });

  it('reports a related list with no link to the root: none, a named non-link, or several unnamed', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'account' }] })] })).toEqual([
      [AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0]'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_revision', field: 'version' }] })] })).toEqual([
      [AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0].field'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_link' }] })] })).toEqual([
      [AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0]'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_link', field: 'to_policy' }] })] })).toEqual([]);
  });

  it('reports a body that is not a long-text field', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ body: { field: 'title' } })] })).toEqual([
      [AI_CONTEXT_BODY_NOT_LONG_TEXT, 'aiContexts[0].body.field'],
    ]);
  });

  // The runtime answer this verdict matches, measured over one real kernel (the
  // `/mcp` door, the real protocol, `SqlDriver`): on an object that declares
  // neither `owner_id` nor `created_at`, the served definition carries both,
  // and `get_record_context` answers both in the root's `fields`, a related
  // list's `fields`, its `where` and its `orderBy`. On an `ownership: 'org'`
  // object the platform injects no `owner_id` and the tool leaves it out.
  // `service-record-context`'s shared harness (`record-context-tools.test.ts`) pins the
  // executor's half over a door serving the same registry-injected shape.
  it('an injected system column the object does not declare is no unknown field (owner_id, created_at)', () => {
    const stack = {
      objects,
      aiContexts: [pack({
        fields: ['title', 'owner_id', 'created_at'],
        related: [{
          object: 'policy_revision',
          fields: ['version', 'owner_id', 'created_by'],
          where: { owner_id: 'usr_1' },
          orderBy: [{ field: 'created_at', order: 'desc' }],
        }],
      })],
    };
    expect(objects.flatMap((o) => Object.keys(o.fields))).not.toContain('owner_id');
    expect(validateAiContext(stack)).toEqual([]);
  });

  // `id` is provisioned by the driver, not the injection pass, so no injected
  // definition carries it; existence resolves through `injectedColumnsFor`.
  it('`id` is no unknown field, in fields, related fields, where and orderBy', () => {
    const stack = {
      objects,
      aiContexts: [pack({
        fields: ['title', 'id'],
        related: [{ object: 'policy_revision', fields: ['version', 'id'], where: { id: 'rev_1' }, orderBy: [{ field: 'id' }] }],
      })],
    };
    expect(objects.flatMap((o) => Object.keys(o.fields))).not.toContain('id');
    expect(validateAiContext(stack)).toEqual([]);
    // Through the CLI tier too (`os validate`).
    expect(runAuthoringRules('validate', { parsed: stack, normalized: stack }).filter((f) => f.rule.startsWith('ai-context-')))
      .toEqual([]);
    // CONTROL: a misspelling beside it is still reported.
    expect(rulesOf({ objects, aiContexts: [pack({ fields: ['idd'], related: undefined })] })).toEqual([
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].fields[0]'],
    ]);
  });

  it('a body naming `id` exists and is judged not long text, never unknown', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ body: { field: 'id' } })] })).toEqual([
      [AI_CONTEXT_BODY_NOT_LONG_TEXT, 'aiContexts[0].body.field'],
    ]);
  });

  it('a column the platform does not inject on the object is still unknown: owner_id under ownership org', () => {
    const orgOwned = objects.map((o) => (o.name === 'policy' || o.name === 'policy_revision' ? { ...o, ownership: 'org' } : o));
    const stack = {
      objects: orgOwned,
      aiContexts: [pack({
        fields: ['title', 'owner_id', 'created_at'],
        related: [{ object: 'policy_revision', fields: ['owner_id'], where: { owner_id: 'usr_1' }, orderBy: [{ field: 'owner_id' }] }],
      })],
    };
    expect(rulesOf(stack)).toEqual([
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].fields[1]'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].fields[0]'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].where'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].orderBy[0].field'],
    ]);
    // And `systemFields: false` withholds every injected column, `created_at` included.
    const optedOut = objects.map((o) => (o.name === 'policy' ? { ...o, systemFields: false } : o));
    expect(rulesOf({ objects: optedOut, aiContexts: [pack({ fields: ['created_at'], related: undefined })] })).toEqual([
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].fields[0]'],
    ]);
  });

  it('a body naming an injected column is judged by the injected definition, not reported unknown', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ body: { field: 'created_at' } })] })).toEqual([
      [AI_CONTEXT_BODY_NOT_LONG_TEXT, 'aiContexts[0].body.field'],
    ]);
  });

  it('on a sys_ root, the child\'s injected references to it are links, as get_record_context resolves them', () => {
    const withUser = [
      ...objects,
      { name: 'sys_user', fields: { name: { type: 'text' } } },
      { name: 'task', fields: { subject: { type: 'text' }, assignee: { type: 'lookup', reference: 'sys_user' } } },
    ];
    const userPack = { name: 'user_brief', object: 'sys_user', fields: ['name'] };
    const [finding] = validateAiContext({ objects: withUser, aiContexts: [{ ...userPack, related: [{ object: 'task' }] }] });
    expect([finding?.rule, finding?.path]).toEqual([AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0]']);
    expect(finding?.message).toContain('assignee');
    expect(finding?.message).toContain('owner_id');
    expect(validateAiContext({ objects: withUser, aiContexts: [{ ...userPack, related: [{ object: 'task', field: 'assignee' }] }] })).toEqual([]);
  });

  it('every verdict is a warning, and every rule it emits has an `os explain` entry', () => {
    const findings = validateAiContext({ objects, aiContexts: [pack({ fields: ['nope'], body: { field: 'title' } })] });
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    for (const id of [AI_CONTEXT_OBJECT_UNKNOWN, AI_CONTEXT_FIELD_UNKNOWN, AI_CONTEXT_FIELD_UNPROVISIONED, AI_CONTEXT_RELATED_LINK_UNKNOWN, AI_CONTEXT_BODY_NOT_LONG_TEXT, AI_CONTEXT_SORT_FIELD_UNSORTABLE]) {
      expect(explainRule(id), id).toBeTruthy();
    }
  });

  it('the `ai-context-field-unknown` explanation counts injected columns as defined, and names the external case', () => {
    const text = explainRule(AI_CONTEXT_FIELD_UNKNOWN)?.paragraphs.join(' ') ?? '';
    expect(text).toContain('injected');
    expect(text).toContain('owner_id');
    expect(text).toContain(AI_CONTEXT_FIELD_UNPROVISIONED);
  });
});

/**
 * [ADR-0015] An `external` object's injected columns resolve — the published
 * definition carries them, so `ai-context-field-unknown` stays silent — but
 * the platform provisions no column behind them. The provenance answer is the
 * spec's (`unprovisionedInjectedColumnsFor`), the one every unprovisioned-anchor
 * rule here reads; an author-declared column of the same name is the author's.
 */
describe('validateAiContext — an injected column with no storage on an external object (ADR-0015)', () => {
  const external = (names: string[]) =>
    objects.map((o) => (names.includes(o.name) ? { ...o, external: { remoteName: `${o.name}s` } } : o));
  const injectedPack = pack({
    fields: ['title', 'owner_id', 'created_at'],
    related: [{
      object: 'policy_revision',
      field: 'policy',
      fields: ['version', 'created_by'],
      where: { owner_id: 'usr_1' },
      orderBy: [{ field: 'created_at', order: 'desc' }],
    }],
  });

  it('warns at every name the pack reads off an injected column, on the root and a related list', () => {
    const findings = validateAiContext({ objects: external(['policy', 'policy_revision']), aiContexts: [injectedPack] });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].fields[1]'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].fields[2]'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].fields[1]'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].where'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].orderBy[0].field'],
    ]);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    // Each finding names its object and column, the shared anchor fix beside it.
    const [rootOwner, , childCreator] = findings;
    expect(rootOwner?.message).toContain("'owner_id'");
    expect(rootOwner?.message).toContain("external object 'policy'");
    expect(childCreator?.message).toContain("external object 'policy_revision'");
    expect(rootOwner?.hint).toContain('columnMap');
  });

  it('the same pack on objects that are not external is clean', () => {
    expect(validateAiContext({ objects, aiContexts: [injectedPack] })).toEqual([]);
  });

  it('judges each object by its own provenance: an external child under a local root', () => {
    expect(rulesOf({ objects: external(['policy_revision']), aiContexts: [injectedPack] })).toEqual([
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].fields[1]'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].where'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].orderBy[0].field'],
    ]);
  });

  it('a column the author declares on the external object is theirs, and never judged', () => {
    const declared = external(['policy']).map((o) =>
      o.name === 'policy' ? { ...o, fields: { ...o.fields, owner_id: { type: 'text', label: 'Remote owner' } } } : o);
    expect(rulesOf({ objects: declared, aiContexts: [pack({ fields: ['title', 'owner_id'] })] })).toEqual([]);
  });

  it('a body on an injected column carries no body twice over: not long text, and no storage', () => {
    expect(rulesOf({ objects: external(['policy']), aiContexts: [pack({ body: { field: 'created_at' } })] })).toEqual([
      [AI_CONTEXT_BODY_NOT_LONG_TEXT, 'aiContexts[0].body.field'],
      [AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].body.field'],
    ]);
  });

  it('a related list linked through an injected reference of an external child reads no rows', () => {
    const withUser = [
      ...objects,
      { name: 'sys_user', fields: { name: { type: 'text' } } },
      { name: 'task', fields: { subject: { type: 'text' } } },
    ];
    const userPack = { name: 'user_brief', object: 'sys_user', fields: ['name'], related: [{ object: 'task', field: 'owner_id' }] };
    const local = validateAiContext({ objects: withUser, aiContexts: [userPack] });
    expect(local).toEqual([]);
    const externalTask = withUser.map((o) => (o.name === 'task' ? { ...o, external: { remoteName: 'tasks' } } : o));
    const [finding, ...rest] = validateAiContext({ objects: externalTask, aiContexts: [userPack] });
    expect(rest).toEqual([]);
    expect([finding?.rule, finding?.path]).toEqual([AI_CONTEXT_FIELD_UNPROVISIONED, 'aiContexts[0].related[0].field']);
    expect(finding?.message).toContain("external object 'task'");
  });

  it('has an `os explain` entry that states the cause, the cost per position and the remedy', () => {
    const entry = explainRule(AI_CONTEXT_FIELD_UNPROVISIONED);
    expect(entry?.rule).toBe(AI_CONTEXT_FIELD_UNPROVISIONED);
    const text = entry?.paragraphs.join(' ') ?? '';
    for (const fact of ['ADR-0015', 'external', '`fields`', '`body.field`', '`where`', '`orderBy`', 'columnMap', AI_CONTEXT_FIELD_UNKNOWN]) {
      expect(text, fact).toContain(fact);
    }
  });
});

/**
 * ADR-0160 D1: "reported at save and by `os validate`". The runtime publish
 * door judges a written `ai_context` against the live objects, and answers
 * the same rule ids, `where`, messages and hints `os validate` prints for the
 * same pack — as advisories, never a refusal (the tier every advisory rule on
 * that door keeps).
 */
describe('validateAiContext on the runtime publish door (ADR-0160 D1)', () => {
  /** One pack written at the door, judged against `objects` as the live context. */
  const atSave = (body: Record<string, unknown>) =>
    runRuntimeAuthoringRules({ type: 'ai_context', item: body, context: { objects } });
  /** The same pack as `os validate` judges it: the CLI command's own entry over the stack. */
  const atValidate = (body: Record<string, unknown>) =>
    runAuthoringRules('validate', { parsed: { objects, aiContexts: [body] }, normalized: { objects, aiContexts: [body] } })
      .filter((f) => f.rule.startsWith('ai-context-'));
  const face = (f: { rule: string; where: string; path: string; message: string; hint?: string; severity: string }) =>
    ({ rule: f.rule, severity: f.severity, where: f.where, path: f.path, message: f.message, hint: f.hint });

  it('the door dispatches an ai_context write to the rule, into the aiContexts collection', () => {
    expect(runtimeAuthoringRulesFor('ai_context').map((r) => r.name)).toContain('validateAiContext');
    expect(stackKeyForType('ai_context')).toBe('aiContexts');
  });

  const FAMILIES: ReadonlyArray<[string, Record<string, unknown>, string, string]> = [
    ['a misspelled field', pack({ fields: ['title', 'titel'] }), AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].fields[1]'],
    ['a misspelled where field', pack({ related: [{ object: 'policy_revision', where: { verison: 'v1' } }] }), AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].where'],
    ['an order on a field not offered as a sort', pack({ related: [{ object: 'policy_revision', orderBy: [{ field: 'rank' }] }] }), AI_CONTEXT_SORT_FIELD_UNSORTABLE, 'aiContexts[0].related[0].orderBy[0].field'],
    ['an unknown related object', pack({ related: [{ object: 'policy_revison' }] }), AI_CONTEXT_OBJECT_UNKNOWN, 'aiContexts[0].related[0].object'],
    ['a related list with no link', pack({ related: [{ object: 'account' }] }), AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0]'],
    ['a body that is not long text', pack({ body: { field: 'title' } }), AI_CONTEXT_BODY_NOT_LONG_TEXT, 'aiContexts[0].body.field'],
  ];

  for (const [what, body, rule, path] of FAMILIES) {
    it(`${what} is reported at save as ${rule}, in the words os validate prints, and the save is not refused`, () => {
      const verdict = atSave(body);
      expect(verdict.rulesRun).toContain('validateAiContext');
      expect(verdict.errors, 'an advisory rule never refuses the write').toEqual([]);
      expect(verdict.advisories.map((f) => [f.rule, f.path])).toEqual([[rule, path]]);
      expect(verdict.advisories.map(face)).toEqual(atValidate(body).map(face));
    });
  }

  it('under a stated package scope, an installed object outside the closure is worded for the closure, with the closure remedy', () => {
    const scoped = objects.map((o) => ({ ...o, _packageId: o.name === 'account' ? 'com.other' : 'app.policy' }));
    const body = pack({ related: [{ object: 'account' }] });
    const verdict = runRuntimeAuthoringRules({
      type: 'ai_context',
      item: body,
      context: { objects: scoped },
      packageScope: { packageId: 'app.policy', dependencies: [] },
    });
    expect(verdict.errors, 'an advisory rule never refuses the write').toEqual([]);
    expect(verdict.advisories.map((f) => [f.rule, f.path])).toEqual([[AI_CONTEXT_OBJECT_UNKNOWN, 'aiContexts[0].related[0].object']]);
    const [finding] = verdict.advisories;
    expect(finding!.message).toContain('outside the closure of package "app.policy"');
    expect(finding!.message).not.toContain('this stack does not define');
    expect(finding!.hint).toBe(
      'Declare a dependency on the package that defines "account" in the `dependencies` of "app.policy"\'s manifest, '
      + 'or name an object inside that closure',
    );
    // Non-vacuous: declaring the dependency brings the object into the closure, and the pack is clean.
    expect(runRuntimeAuthoringRules({
      type: 'ai_context',
      item: body,
      context: { objects: scoped },
      packageScope: { packageId: 'app.policy', dependencies: ['com.other'] },
    }).advisories.filter((f) => f.rule === AI_CONTEXT_OBJECT_UNKNOWN)).toEqual([]);
  });

  it('with no scope the object verdict keeps the words os validate prints', () => {
    const [finding] = validateAiContext({ objects, aiContexts: [pack({ object: 'polcy', related: undefined, body: undefined })] });
    expect(finding!.message).toBe("names object 'polcy', which this stack does not define, so the pack reads nothing of it");
    expect(finding!.hint).toBe('Name an object the stack defines (check the spelling), or remove the entry');
  });

  it('a pack that names only what the live objects define earns nothing at save', () => {
    const verdict = atSave(pack());
    expect(verdict.rulesRun).toContain('validateAiContext');
    expect(verdict.advisories).toEqual([]);
    expect(verdict.errors).toEqual([]);
  });
});
