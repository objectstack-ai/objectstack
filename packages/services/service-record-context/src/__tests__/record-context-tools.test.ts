// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_MAX_FIELDS,
  AI_CONTEXT_MAX_RELATED,
  AI_CONTEXT_MAX_RELATED_FIELDS,
  GET_RECORD_CONTEXT_TOOL_NAME,
  GetRecordContextOutputSchema,
} from '@objectstack/spec/ai';
import {
  RECORD_CONTEXT_BODY_MAX_CHARS,
  RECORD_CONTEXT_RELATED_MAX_ROWS,
  RECORD_CONTEXT_SERVICE,
  RecordContextServicePlugin,
  executeGetRecordContext,
  getRecordContextToolDefinitions,
  recordContextReadSet,
} from '../index.js';
import { fakeDoor, policyApp, type FakeApp } from './fake-door.js';

const CALL = { objectName: 'policy', recordId: 'p1' };

/** The thrown refusal, as `{ code, status, message }`. */
async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code: string; status: number; message: string };
    return { code: e.code, status: e.status, message: e.message };
  }
  throw new Error('expected a refusal');
}

const run = (app: FakeApp, input: Record<string, unknown> = CALL) => executeGetRecordContext(input, fakeDoor(app));

describe('get_record_context — the service constants (ADR-0160 D3: pinned by test)', () => {
  it('fixes the body bound and the related-row cap', () => {
    expect(RECORD_CONTEXT_BODY_MAX_CHARS).toBe(8000);
    expect(RECORD_CONTEXT_RELATED_MAX_ROWS).toBe(20);
  });

  it('fixes the authoring bounds the schema refuses at parse', () => {
    expect([AI_CONTEXT_MAX_FIELDS, AI_CONTEXT_MAX_RELATED, AI_CONTEXT_MAX_RELATED_FIELDS]).toEqual([30, 3, 10]);
  });

  it('defines one tool, under the spec\'s name, with the spec\'s input and output', () => {
    const [definition, ...rest] = getRecordContextToolDefinitions();
    expect(rest).toEqual([]);
    expect(definition.name).toBe(GET_RECORD_CONTEXT_TOOL_NAME);
    expect(Object.keys((definition.parameters as { properties: object }).properties)).toEqual(
      expect.arrayContaining(['objectName', 'recordId', 'context', 'anchor']),
    );
    expect(definition.outputSchema).toBeDefined();
  });

  it('registers the record-context service a host resolves by name', async () => {
    const registered: Record<string, unknown> = {};
    await new RecordContextServicePlugin().init({
      registerService: (name: string, service: unknown) => { registered[name] = service; },
    } as never);
    const service = registered[RECORD_CONTEXT_SERVICE] as { recordContextTools(): { definitions: unknown[] } };
    expect(service.recordContextTools().definitions).toHaveLength(1);
  });
});

describe('get_record_context — the answer (ADR-0160 D3)', () => {
  it('carries the pack, the record, the fields with display forms, the related list and the body in one envelope', async () => {
    const out = await run(policyApp());
    expect(GetRecordContextOutputSchema.safeParse(out).success).toBe(true);
    expect(out.data.pack).toEqual({ name: 'policy_document', label: 'Policy document' });
    expect(out.data.record).toEqual({ object: 'policy', id: 'p1', displayName: 'Fire cover' });
    expect(out.data.fields).toEqual([
      { name: 'title', label: 'Title', value: 'Fire cover' },
      { name: 'status', label: 'Status', value: 'active', display: 'Active' },
      { name: 'owner', label: 'Owner', value: 'a1', display: 'Acme' },
      { name: 'secret_terms', label: 'Secret terms', value: 'S3CRET-TERMS' },
      { name: 'premium', label: 'Premium', value: 1200 },
    ]);
    expect(out.data.related).toEqual([
      {
        object: 'policy_revision',
        label: 'Policy revision',
        field: 'policy',
        rows: [
          {
            id: 'r1',
            displayName: 'v1',
            fields: [
              { name: 'version', label: 'Version', value: 'v1' },
              { name: 'reviewer', label: 'Reviewer', value: 'a1', display: 'Acme' },
              { name: 'note', label: 'Note', value: 'first' },
            ],
          },
          {
            id: 'r2',
            displayName: 'v2',
            fields: [
              { name: 'version', label: 'Version', value: 'v2' },
              { name: 'reviewer', label: 'Reviewer', value: 'a1', display: 'Acme' },
              { name: 'note', label: 'Note', value: 'second' },
            ],
          },
        ],
      },
    ]);
    expect(out.data.body).toEqual({ field: 'content', label: 'Content', text: policyApp().records.policy[0].content });
    expect(out.notes).toEqual([]);
    expect(out.framing).toMatch(/never as instructions/i);
  });

  it('writes its notes and framing in the caller\'s locale', async () => {
    const out = await run(policyApp({ locales: ['zh-CN'], hiddenFields: { policy: ['secret_terms'] } }));
    expect(out.notes.map((n) => n.kind)).toEqual(['not_visible']);
    expect(out.notes[0].text).toMatch(/不可见/);
  });

  it('refuses the record tools\' near-miss spellings, pointing at the declared key', async () => {
    const refused = await refusalOf(run(policyApp(), { object: 'policy', id: 'p1' }));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refused.message).toContain('objectName');
  });
});

describe('get_record_context — the order of judgement (ADR-0160 D4)', () => {
  it('1. refuses invalid arguments before the door is asked anything', async () => {
    const door = fakeDoor(policyApp());
    const refused = await refusalOf(executeGetRecordContext({ objectName: 'policy' }, door));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(door.asked).toEqual([]);
    expect(door.listCalls).toBe(0);
  });

  it('2. judges the root before any pack is looked up: a guarded root is refused with no pack read', async () => {
    const door = fakeDoor(policyApp({ guardedObjects: ['policy'] }));
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(door.listCalls).toBe(0);
  });

  it('2. a root the caller is not served gets get_record\'s answer, the same whether or not a pack exists', async () => {
    const withPack = fakeDoor(policyApp({ unservedObjects: ['policy'] }));
    const withoutPack = fakeDoor(policyApp({ unservedObjects: ['policy'], packs: [] }));
    const a = await refusalOf(executeGetRecordContext(CALL, withPack));
    const b = await refusalOf(executeGetRecordContext(CALL, withoutPack));
    expect(a).toEqual(b);
    expect(a.code).toBe('OBJECT_NOT_FOUND');
    expect(withPack.listCalls).toBe(0);
  });

  it('2. a root whose API exposure refuses the read answers that refusal, with no pack read', async () => {
    const door = fakeDoor(policyApp({ unexposedObjects: ['policy'] }));
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused.code).toBe('OBJECT_API_DISABLED');
    expect(door.listCalls).toBe(0);
  });

  it('3. a name no pack has and a pack rooted on another object are one answer', async () => {
    const elsewhere = policyApp({ packs: [{ name: 'claim_pack', label: 'Claim', object: 'claim', fields: ['number'] }] });
    const nowhere = policyApp({ packs: [] });
    const a = await refusalOf(run(elsewhere, { ...CALL, context: 'claim_pack' }));
    const b = await refusalOf(run(nowhere, { ...CALL, context: 'claim_pack' }));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('3. no pack on the object is refused and names get_record as the way to read it', async () => {
    const refused = await refusalOf(run(policyApp({ packs: [] })));
    expect(refused).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(refused.message).toContain('get_record');
  });

  it('3. several packs on the object are refused, naming them', async () => {
    const second = { name: 'policy_brief', label: 'Brief', object: 'policy', fields: ['title'] };
    const refused = await refusalOf(run(policyApp({ packs: [...policyApp().packs, second] })));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refused.message).toContain('policy_brief, policy_document');
  });

  it('4. a related child the read guard refuses is refused before its definition is read, and no record is read', async () => {
    const door = fakeDoor(policyApp({ guardedObjects: ['policy_revision'] }));
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(door.asked).not.toContainEqual({ member: 'servedObjectDefinitionOf', object: 'policy_revision' });
    expect(door.reads).toEqual([]);
  });

  it('4. the children are judged before the lookups\' targets', async () => {
    const door = fakeDoor(policyApp({ guardedObjects: ['policy_revision', 'account'] }));
    await refusalOf(executeGetRecordContext(CALL, door));
    const guarded = door.asked.filter((a) => a.member === 'readGuard').map((a) => a.object);
    expect(guarded).toEqual(['policy', 'policy_revision']);
  });

  it('4. a refused lookup target refuses the whole call before any record is read', async () => {
    const door = fakeDoor(policyApp({ guardedObjects: ['account'] }));
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(door.reads).toEqual([]);
  });

  it('4. a lookup the caller\'s schema hides is dropped before its target is judged, so it refuses nothing', async () => {
    const pack = { name: 'policy_document', label: 'Policy document', object: 'policy', fields: ['title', 'owner'] };
    const door = fakeDoor(policyApp({ packs: [pack], hiddenFields: { policy: ['owner'] }, guardedObjects: ['account'] }));
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.fields.map((f) => f.name)).toEqual(['title']);
    expect(door.asked).not.toContainEqual({ member: 'readGuard', object: 'account' });
  });
});

describe('get_record_context — object level: one refusal is the whole call\'s, within the naming bound (ADR-0160 D3/D4)', () => {
  it('a child the caller is not served is refused PERMISSION_DENIED without naming it', async () => {
    const refused = await refusalOf(run(policyApp({ unservedObjects: ['policy_revision'] })));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toContain('policy_document');
    expect(refused.message).toContain('policy');
    expect(refused.message).not.toContain('policy_revision');
  });

  it('a child the read guard refuses is refused with the same code, unnamed', async () => {
    const refused = await refusalOf(run(policyApp({ guardedObjects: ['policy_revision'] })));
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.message).not.toContain('policy_revision');
  });

  it('a child the caller\'s schema shows and API exposure refuses is named, with the same code', async () => {
    const refused = await refusalOf(run(policyApp({ unexposedObjects: ['policy_revision'] })));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toContain("'policy_revision'");
  });

  it('a refused lookup target is not named', async () => {
    const refused = await refusalOf(run(policyApp({ guardedObjects: ['account'] })));
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.message).not.toContain('account');
  });

  it('a child\'s gates are judged before ANY read of its definition, the published one included', async () => {
    for (const app of [
      policyApp({ guardedObjects: ['policy_revision'] }),
      policyApp({ unservedObjects: ['policy_revision'] }),
      policyApp({ unexposedObjects: ['policy_revision'] }),
    ]) {
      const door = fakeDoor(app);
      await refusalOf(executeGetRecordContext(CALL, door));
      expect(door.asked).not.toContainEqual({ member: 'publishedObjectDefinitionOf', object: 'policy_revision' });
    }
    const door = fakeDoor(policyApp());
    await executeGetRecordContext(CALL, door);
    const at = (member: string) => door.asked.findIndex((a) => a.member === member && a.object === 'policy_revision');
    expect(at('assertApiExposed')).toBeLessThan(at('publishedObjectDefinitionOf'));
  });

  it('a child\'s exposure check failing for any reason but API exposure refuses unnamed', async () => {
    const door = fakeDoor(policyApp());
    const exposedOf = door.assertApiExposed.bind(door);
    door.assertApiExposed = async (object, action) => {
      if (object === 'policy_revision') {
        throw Object.assign(new Error(`Object '${object}' belongs to a disabled package`), { code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
      }
      return exposedOf(object, action);
    };
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).not.toContain('policy_revision');
  });

  it('a published-definition read that throws after the gates refuses the call unnamed, whatever the door\'s error says', async () => {
    const refused = await refusalOf(run(policyApp({ unpublishedObjects: ['policy_revision'] })));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).not.toContain('policy_revision');
    expect(refused.message).not.toContain('disabled package');
  });

  it('a lookup whose target the published plan does not reach refuses the call unnamed, before any record is read', async () => {
    // The served definition points `owner` somewhere the published one does not.
    const door = fakeDoor(policyApp());
    const servedOf = door.servedObjectDefinitionOf.bind(door);
    door.servedObjectDefinitionOf = async (object) => {
      const def = await servedOf(object);
      if (object !== 'policy' || !def) return def;
      const fields = def.fields as Record<string, Record<string, unknown>>;
      return { ...def, fields: { ...fields, owner: { ...fields.owner, reference: 'claim' } } };
    };
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).not.toContain('claim');
    expect(door.reads).toEqual([]);
  });
});

describe('get_record_context — field level: omit and state, or name the withheld (ADR-0160 D3)', () => {
  it('a field the caller\'s schema hides is not named, and the notes carry ONE not-visible statement', async () => {
    const out = await run(policyApp({ hiddenFields: { policy: ['secret_terms'], policy_revision: ['note'] } }));
    const text = JSON.stringify(out);
    expect(text).not.toContain('secret_terms');
    expect(text).not.toContain('Secret terms');
    expect(text).not.toContain('S3CRET');
    expect(out.data.related?.[0].rows[0].fields.map((f) => f.name)).toEqual(['version', 'reviewer']);
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toEqual({ kind: 'not_visible', text: expect.any(String) });
  });

  it('a name the published definition lacks is an author defect and states nothing', async () => {
    const pack = { ...(policyApp().packs[0] as object), fields: ['title', 'ghost_field'] };
    const out = await run(policyApp({ packs: [pack] }));
    expect(out.data.fields.map((f) => f.name)).toEqual(['title']);
    expect(out.notes).toEqual([]);
  });

  it('a hidden body drops the body section, with the same statement', async () => {
    const out = await run(policyApp({ hiddenFields: { policy: ['content'] } }));
    expect(out.data.body).toBeUndefined();
    expect(JSON.stringify(out.data)).not.toContain('content');
    expect(JSON.stringify(out)).not.toContain('Covers fire');
    expect(out.notes.map((n) => n.kind)).toEqual(['not_visible']);
  });

  it('a related entry whose link the caller\'s schema hides drops the section, with the same statement', async () => {
    const out = await run(policyApp({ hiddenFields: { policy_revision: ['policy'] } }));
    expect(out.data.related).toBeUndefined();
    expect(out.notes.map((n) => n.kind)).toEqual(['not_visible']);
  });

  it('an exempt caller (served schema shows it, getReadableFields leaves it out) gets the #35137 withheld naming', async () => {
    const out = await run(policyApp({ withheldFields: { policy: ['secret_terms'] } }));
    expect(out.data.fields).toContainEqual({ name: 'secret_terms', label: 'Secret terms', withheld: true });
    expect(JSON.stringify(out)).not.toContain('S3CRET');
    expect(out.notes).toEqual([
      { kind: 'withheld_fields', fields: ['secret_terms'], text: expect.stringContaining('secret_terms') },
    ]);
  });
});

describe('get_record_context — row level (ADR-0160 D3)', () => {
  it('a related row the caller cannot read is absent: no id, no count, no marker', async () => {
    const out = await run(policyApp({ unreadableRows: ['r2'] }));
    const list = out.data.related![0];
    expect(list.rows.map((r) => r.id)).toEqual(['r1']);
    expect(list.truncated).toBeUndefined();
    const text = JSON.stringify(out);
    expect(text).not.toContain('r2');
    expect(text).not.toContain('v2');
    expect(out.notes).toEqual([]);
  });

  it('a multi-valued link is matched with $contains, as get_record matches it', async () => {
    const app = policyApp();
    const revision = app.objects.policy_revision as { fields: Record<string, Record<string, unknown>> };
    revision.fields.policy = { ...revision.fields.policy, multiple: true };
    app.records.policy_revision = [
      { id: 'r1', version: 'v1', policy: ['p1', 'p2'], reviewer: 'a1', note: 'shared' },
      { id: 'r9', version: 'v9', policy: ['p2'], reviewer: 'a1', note: 'other policy' },
    ];
    const door = fakeDoor(app);
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r1']);
    const read = door.reads.find((r) => r.object === 'policy_revision') as { opts: { where: unknown } };
    expect(read.opts.where).toEqual({ policy: { $contains: 'p1' } });
  });

  it('a lookup the caller\'s expansion left unexpanded reads not visible and carries no id', async () => {
    const out = await run(policyApp({ unservedObjects: ['account'] }));
    expect(out.data.fields).toContainEqual({ name: 'owner', label: 'Owner', notVisible: true });
    expect(JSON.stringify(out)).not.toContain('a1');
  });

  it('a root record the caller cannot read answers as get_record does', async () => {
    const refused = await refusalOf(run(policyApp({ unreadableRows: ['p1'] })));
    expect(refused).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('a list longer than the cap is cut at the cap, marked, and the cut is stated', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, version: `v${i}`, policy: 'p1', reviewer: 'a1', note: 'n' }));
    const app = policyApp();
    app.records.policy_revision = many;
    const door = fakeDoor(app);
    const out = await executeGetRecordContext(CALL, door);
    const list = out.data.related![0];
    expect(list.rows).toHaveLength(RECORD_CONTEXT_RELATED_MAX_ROWS);
    expect(list.truncated).toBe(true);
    expect(out.notes.map((n) => n.kind)).toEqual(['related_truncated']);
    const listRead = door.reads.find((r) => r.member === 'query' && r.object === 'policy_revision');
    expect((listRead?.opts as { limit: number }).limit).toBe(RECORD_CONTEXT_RELATED_MAX_ROWS + 1);
  });

  it('a list the agent ceiling narrowed carries the security service\'s own sentence', async () => {
    const out = await run(policyApp({ narrowed: { policy_revision: 'Narrowed by the agent ceiling.' } }));
    expect(out.notes).toEqual([{ kind: 'narrowed', object: 'policy_revision', text: 'Narrowed by the agent ceiling.' }]);
  });
});

describe('get_record_context — the body (ADR-0160 D3)', () => {
  const withBody = (content: string) => {
    const app = policyApp();
    app.records.policy[0].content = content;
    return app;
  };
  const longSection = (title: string, n: number) => `# ${title}\n${'x'.repeat(n)}\n`;

  it('a long body is an outline, and a section is read by its anchor', async () => {
    const content = longSection('Scope', 5000) + '## Exclusions\nArson.\n' + longSection('Claims', 5000);
    const outline = await run(withBody(content));
    expect(outline.data.body?.text).toBeUndefined();
    expect(outline.data.body?.outline).toEqual([
      { anchor: 'scope', heading: 'Scope', level: 1 },
      { anchor: 'exclusions', heading: 'Exclusions', level: 2 },
      { anchor: 'claims', heading: 'Claims', level: 1 },
    ]);
    expect(outline.notes.map((n) => n.kind)).toEqual(['body_outline']);

    const section = await run(withBody(content), { ...CALL, anchor: 'exclusions' });
    expect(section.data.body).toEqual({ field: 'content', label: 'Content', anchor: 'exclusions', text: '## Exclusions\nArson.\n' });
  });

  it('a long body with no headings is carried to the bound and marked truncated', async () => {
    const out = await run(withBody('y'.repeat(RECORD_CONTEXT_BODY_MAX_CHARS + 50)));
    expect(out.data.body?.text).toHaveLength(RECORD_CONTEXT_BODY_MAX_CHARS);
    expect(out.data.body?.truncated).toBe(true);
    expect(out.notes.map((n) => n.kind)).toEqual(['body_truncated']);
  });

  it('a repeated heading gets a numbered anchor', async () => {
    const content = longSection('Notes', 5000) + longSection('Notes', 5000);
    const out = await run(withBody(content));
    expect(out.data.body?.outline?.map((h) => h.anchor)).toEqual(['notes', 'notes-2']);
  });

  it('an anchor that does not resolve is ONE answer: stale, no body in the pack, or a body the caller cannot see', async () => {
    const stale = await refusalOf(run(policyApp(), { ...CALL, anchor: 'gone' }));
    const noBody = await refusalOf(
      run(policyApp({ packs: [{ name: 'policy_document', label: 'Policy document', object: 'policy', fields: ['title'] }] }), {
        ...CALL,
        anchor: 'gone',
      }),
    );
    const hiddenBody = await refusalOf(run(policyApp({ hiddenFields: { policy: ['content'] } }), { ...CALL, anchor: 'gone' }));
    expect(stale).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(noBody).toEqual(stale);
    expect(hiddenBody).toEqual(stale);
  });
});

describe('get_record_context — the read set (ADR-0160 D4 ③)', () => {
  const metadataOf = (app: FakeApp) => ({
    listContextPacks: async () => app.packs,
    publishedObjectDefinitionOf: async (name: string) => app.objects[name] ?? null,
  });

  it('is a function of the arguments and published metadata: root, related children, lookup targets', async () => {
    const app = policyApp();
    expect(await recordContextReadSet({ objectName: 'policy' }, metadataOf(app))).toEqual({
      pack: 'policy_document',
      objects: ['policy', 'policy_revision', 'account'],
    });
    expect(await recordContextReadSet({ objectName: 'policy', context: 'nope' }, metadataOf(app))).toEqual({ objects: ['policy'] });
  });

  it.each<[string, Partial<FakeApp>]>([
    ['the full pack', {}],
    ['a caller with hidden fields', { hiddenFields: { policy: ['owner'], policy_revision: ['reviewer'] } }],
    ['a caller with unreadable rows', { unreadableRows: ['r1'] }],
    ['a caller not served a lookup target', { unservedObjects: ['account'] }],
    ['a refused child', { unservedObjects: ['policy_revision'] }],
  ])('the executor asks the door about no object outside it — %s', async (_label, overrides) => {
    const app = policyApp(overrides);
    const { objects } = await recordContextReadSet({ objectName: 'policy' }, metadataOf(app));
    const door = fakeDoor(app);
    await executeGetRecordContext(CALL, door).catch(() => undefined);
    for (const { object } of door.asked) expect(objects).toContain(object);
  });
});
