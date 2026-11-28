// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_SOURCE_FIELD_NEVER_INDEXED,
  KNOWLEDGE_SOURCE_FIELD_UNKNOWN,
  KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE,
  KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
  KNOWLEDGE_SOURCE_SYSTEM_OBJECT_NOT_AI_READABLE,
  validateKnowledgeSource,
} from './validate-knowledge-source.js';
import { explainRule } from './rule-explanations.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor, stackKeyForType } from './runtime-gate.js';

const objects = [
  {
    name: 'kb_article',
    fields: {
      title: { type: 'text' },
      body: { type: 'markdown' },
      status: { type: 'select' },
      api_token: { type: 'secret' },
      triage_note: { type: 'text', internal: true },
    },
  },
  { name: 'private_note', enable: { apiEnabled: false }, fields: { body: { type: 'text' } } },
  { name: 'get_only', enable: { apiMethods: ['get'] }, fields: { body: { type: 'text' } } },
  { name: 'unsearchable', enable: { apiMethods: ['get', 'list'], searchable: false }, fields: { body: { type: 'text' } } },
  { name: 'sys_audit_note', fields: { body: { type: 'text' } } },
  { name: 'sys_help_topic', enable: { aiReadable: true }, fields: { body: { type: 'text' } } },
];

/** A source over `kb_article` that names only what the object defines; `source` overrides the source keys. */
const kbSource = (source: Record<string, unknown> = {}, name = 'support_kb') => ({
  name,
  label: 'Support KB',
  source: { kind: 'object', object: 'kb_article', content: ['title', 'body'], metadataFields: ['status'], ...source },
});

const KS_RULE = /^knowledge-source-/;

/** `os validate`'s verdict on one source: the CLI command's own registry entry over the stack. */
const atValidate = (source: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const stack = { objects, knowledgeSources: [source], ...extra };
  return runAuthoringRules('validate', { parsed: stack, normalized: stack }).filter((f) => KS_RULE.test(f.rule));
};

/** The runtime publish door's verdict on one source written against `objects` as the live context. */
const atPublish = (source: Record<string, unknown>) =>
  runRuntimeAuthoringRules({ type: 'knowledge_source', item: source, context: { objects } });

const face = (f: { rule: string; severity: string; where: string; message: string; hint?: string }) =>
  ({ rule: f.rule, severity: f.severity, where: f.where, message: f.message, hint: f.hint });

/**
 * The card's acceptance families: each prints exactly one finding, with the
 * rule id, the path, and the object or field named in its message.
 */
const FAMILIES: ReadonlyArray<[string, Record<string, unknown>, string, 'error' | 'warning', string, string]> = [
  ['a missing object', kbSource({ object: 'kb_artcle' }), KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'error', 'knowledgeSources[0].source.object', "'kb_artcle'"],
  ['a missing content field', kbSource({ content: ['title', 'bdy'] }), KNOWLEDGE_SOURCE_FIELD_UNKNOWN, 'error', 'knowledgeSources[0].source.content[1]', "'bdy'"],
  ['a missing metadata field', kbSource({ metadataFields: ['stage'] }), KNOWLEDGE_SOURCE_FIELD_UNKNOWN, 'error', 'knowledgeSources[0].source.metadataFields[0]', "'stage'"],
  ['an object with apiEnabled: false', kbSource({ object: 'private_note', content: ['body'], metadataFields: [] }), KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE, 'error', 'knowledgeSources[0].source.object', "'private_note'"],
  ['an object whose apiMethods do not grant search', kbSource({ object: 'get_only', content: ['body'], metadataFields: [] }), KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE, 'error', 'knowledgeSources[0].source.object', "'get_only'"],
  ['an object that lists but declares searchable: false', kbSource({ object: 'unsearchable', content: ['body'], metadataFields: [] }), KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE, 'error', 'knowledgeSources[0].source.object', "'unsearchable'"],
  ['a sys_ object without enable.aiReadable', kbSource({ object: 'sys_audit_note', content: ['body'], metadataFields: [] }), KNOWLEDGE_SOURCE_SYSTEM_OBJECT_NOT_AI_READABLE, 'error', 'knowledgeSources[0].source.object', "'sys_audit_note'"],
  ['a credential-class content field', kbSource({ content: ['title', 'api_token'] }), KNOWLEDGE_SOURCE_FIELD_NEVER_INDEXED, 'warning', 'knowledgeSources[0].source.content[1]', "'api_token'"],
  ['an internal metadata field', kbSource({ metadataFields: ['triage_note'] }), KNOWLEDGE_SOURCE_FIELD_NEVER_INDEXED, 'warning', 'knowledgeSources[0].source.metadataFields[0]', "'triage_note'"],
];

describe('validateKnowledgeSource in os validate (ADR-0161 K4, row 4)', () => {
  for (const [what, source, rule, severity, path, named] of FAMILIES) {
    it(`${what} prints one ${severity} ${rule}, naming ${named}`, () => {
      const findings = atValidate(source);
      expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([[rule, severity, path]]);
      expect(findings[0]!.message).toContain(named);
      expect(findings[0]!.where).toBe('knowledge source "support_kb"');
    });
  }

  it('a clean source prints nothing', () => {
    expect(atValidate(kbSource())).toEqual([]);
  });

  it('an apiMethods list that grants list grants search, as the exposure decision derives it', () => {
    const withList = [...objects, { name: 'listed', enable: { apiMethods: ['get', 'list'] }, fields: { body: { type: 'text' } } }];
    const stack = { objects: withList, knowledgeSources: [kbSource({ object: 'listed', content: ['body'], metadataFields: [] })] };
    expect(validateKnowledgeSource(stack)).toEqual([]);
  });

  it('a sys_ object that declares enable.aiReadable: true passes the system-object gate', () => {
    expect(atValidate(kbSource({ object: 'sys_help_topic', content: ['body'], metadataFields: [] }))).toEqual([]);
  });

  it('a system column the platform injects is a field the source may name', () => {
    expect(atValidate(kbSource({ metadataFields: ['owner_id', 'created_at'] }))).toEqual([]);
  });

  it('`id`, which the driver provisions without a declaration, resolves like a declared field', () => {
    expect(atValidate(kbSource({ metadataFields: ['id', 'status'] }))).toEqual([]);
    expect(atValidate(kbSource({ content: ['id', 'title'] }))).toEqual([]);
    expect(atPublish(kbSource({ metadataFields: ['id'] })).errors).toEqual([]);
  });

  it('`enable.searchable: false` with no `apiMethods` list does not refuse search', () => {
    const open = { name: 'open_note', enable: { searchable: false }, fields: { body: { type: 'text' } } };
    const source = kbSource({ object: 'open_note', content: ['body'], metadataFields: [] });
    expect(validateKnowledgeSource({ objects: [open], knowledgeSources: [source] })).toEqual([]);
  });

  it('a field an object extension of the stack adds resolves', () => {
    const extension = { extend: 'kb_article', fields: { product: { type: 'text' } } };
    expect(atValidate(kbSource({ metadataFields: ['product'] }), { objectExtensions: [extension] })).toEqual([]);
    expect(atValidate(kbSource({ metadataFields: ['product'] })).map((f) => f.rule)).toEqual([KNOWLEDGE_SOURCE_FIELD_UNKNOWN]);
  });

  it('an object a package of the same artifact ships resolves, and is judged', () => {
    const packages = [{ manifest: { id: 'com.acme.kb', objects: [{ name: 'faq_entry', fields: { answer: { type: 'text' } } }] } }];
    expect(atValidate(kbSource({ object: 'faq_entry', content: ['answer'], metadataFields: [] }), { packages })).toEqual([]);
    expect(atValidate(kbSource({ object: 'faq_entry', content: ['answr'], metadataFields: [] }), { packages }).map((f) => f.rule))
      .toEqual([KNOWLEDGE_SOURCE_FIELD_UNKNOWN]);
  });

  it('a platform object a known package registers is not judged when the stack does not carry it', () => {
    expect(atValidate(kbSource({ object: 'sys_user', content: ['name'], metadataFields: [] }))).toEqual([]);
  });

  it('a platform-prefixed name no known package registers is a warning, not an error', () => {
    const findings = atValidate(kbSource({ object: 'sys_kb_article', content: ['body'], metadataFields: [] }));
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'warning']]);
  });

  it('on the CLI, a missing object is a warning while the manifest declares a dependency the artifact does not carry', () => {
    const manifest = { id: 'app.kb', dependencies: { 'com.acme.faq': '^1.0.0' } };
    const source = kbSource({ object: 'faq_entry', content: ['answer'], metadataFields: [] });
    const findings = atValidate(source, { manifest });
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'warning', 'knowledgeSources[0].source.object'],
    ]);
    expect(findings[0]!.message).toContain('"com.acme.faq"');
    expect(findings[0]!.hint).toContain('Ignore this if a declared dependency defines the object');
  });

  it('on the CLI, a missing object stays an error when every declared dependency is carried, or none is declared', () => {
    const carried = [{ manifest: { id: 'com.acme.faq', objects: [{ name: 'faq_topic', fields: { title: { type: 'text' } } }] } }];
    const manifest = { id: 'app.kb', dependencies: { 'com.acme.faq': '^1.0.0' } };
    const source = kbSource({ object: 'faq_entry', content: ['answer'], metadataFields: [] });
    expect(atValidate(source, { manifest, packages: carried }).map((f) => [f.rule, f.severity]))
      .toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'error']]);
    expect(atValidate(source, { manifest: { id: 'app.kb' } }).map((f) => [f.rule, f.severity]))
      .toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'error']]);
  });

  it('a missing object is reported once, and its fields are not judged', () => {
    const findings = atValidate(kbSource({ object: 'nothing_here', content: ['a', 'b'], metadataFields: ['c'] }));
    expect(findings.map((f) => f.rule)).toEqual([KNOWLEDGE_SOURCE_OBJECT_UNKNOWN]);
  });

  it('the error refuses os validate, not only os lint', () => {
    for (const command of ['validate', 'build', 'lint'] as const) {
      const stack = { objects, knowledgeSources: [kbSource({ object: 'kb_artcle' })] };
      const errors = runAuthoringRules(command, { parsed: stack, normalized: stack })
        .filter((f) => f.rule === KNOWLEDGE_SOURCE_OBJECT_UNKNOWN && f.severity === 'error');
      expect(errors, command).toHaveLength(1);
    }
  });
});

/**
 * ADR-0161 K4: "a packaged item meets the gates that need no principal in
 * `os validate` and at publish". The runtime publish door answers the rule
 * ids and messages `os validate` prints for the same source; its errors
 * refuse the publish, unlike the `ai_context` row's advisories.
 */
describe('validateKnowledgeSource on the runtime publish door', () => {
  it('the door dispatches a knowledge_source write to the rule, into the knowledgeSources collection', () => {
    expect(runtimeAuthoringRulesFor('knowledge_source').map((r) => r.name)).toContain('validateKnowledgeSource');
    expect(stackKeyForType('knowledge_source')).toBe('knowledgeSources');
  });

  for (const [what, source, rule, severity] of FAMILIES) {
    it(`${what} is reported at publish as ${rule}, in the words os validate prints${severity === 'error' ? ', and refuses the publish' : ''}`, () => {
      const verdict = atPublish(source);
      expect(verdict.rulesRun).toContain('validateKnowledgeSource');
      const refused = verdict.errors.filter((f) => KS_RULE.test(f.rule));
      const advised = verdict.advisories.filter((f) => KS_RULE.test(f.rule));
      expect((severity === 'error' ? refused : advised).map((f) => f.rule)).toEqual([rule]);
      expect((severity === 'error' ? advised : refused)).toEqual([]);
      expect([...refused, ...advised].map(face)).toEqual(atValidate(source).map(face));
    });
  }

  it('a clean source is published with nothing to report', () => {
    const verdict = atPublish(kbSource());
    expect(verdict.rulesRun).toContain('validateKnowledgeSource');
    expect(verdict.errors).toEqual([]);
    expect(verdict.advisories).toEqual([]);
  });

  it('under a stated package scope, an object outside the closure is refused with the closure remedy', () => {
    const scoped = objects.map((o) => ({ ...o, _packageId: o.name === 'kb_article' ? 'com.other' : 'app.kb' }));
    const verdict = runRuntimeAuthoringRules({
      type: 'knowledge_source',
      item: kbSource(),
      context: { objects: scoped },
      packageScope: { packageId: 'app.kb', dependencies: [] },
    });
    expect(verdict.errors.map((f) => [f.rule, f.path])).toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, expect.stringContaining('source.object')]]);
    const [finding] = verdict.errors;
    expect(finding!.message).toContain('outside the closure of package "app.kb"');
    expect(finding!.hint).toBe(
      'Declare a dependency on the package that defines "kb_article" in the `dependencies` of "app.kb"\'s manifest, '
      + 'or name an object inside that closure',
    );
    // Non-vacuous: declaring the dependency brings the object into the closure, and the source is clean.
    expect(runRuntimeAuthoringRules({
      type: 'knowledge_source',
      item: kbSource(),
      context: { objects: scoped },
      packageScope: { packageId: 'app.kb', dependencies: ['com.other'] },
    }).errors).toEqual([]);
  });

  it('with no scope the object verdict keeps the words os validate prints', () => {
    const [finding] = validateKnowledgeSource({ objects, knowledgeSources: [kbSource({ object: 'kb_artcle' })] });
    expect(finding!.message).toContain("`source.object` names 'kb_artcle', which this stack does not define");
    expect(finding!.hint).toBe(
      'Name an object the stack defines (check the spelling) or a platform object by its full name; for an object '
      + 'another package defines, declare that package in the manifest\'s `dependencies` and install it',
    );
  });

  it('against the whole collection the host serves, a missing object is an error even beside an unseen declared dependency', () => {
    const stack = {
      objects,
      manifest: { id: 'app.kb', dependencies: { 'com.acme.faq': '^1.0.0' } },
      knowledgeSources: [kbSource({ object: 'faq_entry', content: ['answer'], metadataFields: [] })],
    };
    expect(validateKnowledgeSource(stack, { wholeCollection: true }).map((f) => [f.rule, f.severity]))
      .toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'error']]);
    // Non-vacuous: the same stack on the CLI is the hedged warning.
    expect(validateKnowledgeSource(stack).map((f) => [f.rule, f.severity]))
      .toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'warning']]);
  });

  it('the door passes the whole-collection reading when no package scope is stated', () => {
    const item = kbSource({ object: 'faq_entry', content: ['answer'], metadataFields: [] });
    // An empty served collection is no universe at the door: no object verdict is drawn from it.
    expect(runRuntimeAuthoringRules({ type: 'knowledge_source', item, context: { objects: [] } }).errors).toEqual([]);
    // Non-vacuous: a served collection that lacks the object refuses it.
    expect(runRuntimeAuthoringRules({ type: 'knowledge_source', item, context: { objects } }).errors
      .map((f) => [f.rule, f.severity])).toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'error']]);
  });

  it('against the whole collection, an absent platform name, prefixed or known, is refused as an unprefixed one is', () => {
    for (const object of ['sys_kb_article', 'sys_user']) {
      const item = kbSource({ object, content: ['body'], metadataFields: [] });
      const verdict = runRuntimeAuthoringRules({ type: 'knowledge_source', item, context: { objects } });
      expect(verdict.errors.map((f) => [f.rule, f.severity, f.path]), object)
        .toEqual([[KNOWLEDGE_SOURCE_OBJECT_UNKNOWN, 'error', 'knowledgeSources[0].source.object']]);
      expect(verdict.errors[0]!.message, object).toContain(`'${object}', which this stack does not define`);
      expect(verdict.advisories.filter((f) => KS_RULE.test(f.rule)), object).toEqual([]);
    }
    // The CLI arms stay: a prefixed name no known package registers warns, a known platform name is not judged.
    expect(atValidate(kbSource({ object: 'sys_kb_article', content: ['body'], metadataFields: [] })).map((f) => f.severity))
      .toEqual(['warning']);
    expect(atValidate(kbSource({ object: 'sys_user', content: ['name'], metadataFields: [] }))).toEqual([]);
    // CONTROL: a served platform object is no unknown object at the door.
    const served = [...objects, { name: 'sys_kb_article', enable: { aiReadable: true }, fields: { body: { type: 'text' } } }];
    expect(runRuntimeAuthoringRules({
      type: 'knowledge_source',
      item: kbSource({ object: 'sys_kb_article', content: ['body'], metadataFields: [] }),
      context: { objects: served },
    }).errors).toEqual([]);
  });

  it('an empty whole collection at the door is no universe, and judges no object', () => {
    const stack = { objects: [], knowledgeSources: [kbSource({ object: 'faq_entry' })] };
    expect(validateKnowledgeSource(stack, { wholeCollection: true })).toEqual([]);
  });
});

describe('os explain for the knowledge source rules', () => {
  for (const rule of [
    KNOWLEDGE_SOURCE_OBJECT_UNKNOWN,
    KNOWLEDGE_SOURCE_FIELD_UNKNOWN,
    KNOWLEDGE_SOURCE_OBJECT_NOT_SEARCHABLE,
    KNOWLEDGE_SOURCE_SYSTEM_OBJECT_NOT_AI_READABLE,
    KNOWLEDGE_SOURCE_FIELD_NEVER_INDEXED,
  ]) {
    it(`answers ${rule}`, () => {
      const entry = explainRule(rule);
      expect(entry?.rule).toBe(rule);
      expect(entry?.paragraphs.length).toBeGreaterThan(0);
    });
  }
});
