// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_MAX_FIELDS,
  AI_CONTEXT_MAX_RELATED,
  AI_CONTEXT_MAX_RELATED_FIELDS,
  GET_RECORD_CONTEXT_TOOL_NAME,
  GetRecordContextInputSchema,
  GetRecordContextOutputSchema,
} from '@objectstack/spec/ai';
import {
  RECORD_CONTEXT_BODY_MAX_CHARS,
  RECORD_CONTEXT_OUTLINE_MAX_ENTRIES,
  RECORD_CONTEXT_RELATED_MAX_ROWS,
  RECORD_CONTEXT_SERVICE,
  RecordContextServicePlugin,
  executeGetRecordContext,
  getRecordContextToolDefinitions,
  recordContextReadSet,
} from '../index.js';
import { headingsOf } from '../body-outline.js';
import { sentencesFor } from '../sentences.js';
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

  it('fixes the outline\'s entry cap', () => {
    expect(RECORD_CONTEXT_OUTLINE_MAX_ENTRIES).toBe(80);
  });

  it('fixes the authoring bounds the schema refuses at parse', () => {
    expect([AI_CONTEXT_MAX_FIELDS, AI_CONTEXT_MAX_RELATED, AI_CONTEXT_MAX_RELATED_FIELDS]).toEqual([30, 3, 10]);
  });

  it('defines one tool, under the spec\'s name, with the spec\'s input and output', () => {
    const [definition, ...rest] = getRecordContextToolDefinitions();
    expect(rest).toEqual([]);
    expect(definition.name).toBe(GET_RECORD_CONTEXT_TOOL_NAME);
    expect(Object.keys((definition.parameters as { properties: object }).properties)).toEqual(
      expect.arrayContaining(['objectName', 'recordId', 'context', 'anchor', 'outlineFrom']),
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

  it('3. several packs on the object are refused, naming each by its name with its label', async () => {
    const second = { name: 'policy_brief', label: 'Brief', object: 'policy', fields: ['title'] };
    const refused = await refusalOf(run(policyApp({ packs: [...policyApp().packs, second] })));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refused.message).toContain('policy_brief ("Brief"), policy_document ("Policy document")');
  });

  it('3. two packs of one name on the object are refused with one answer, named or not, and nothing is read', async () => {
    const twin = { ...(policyApp().packs[0] as Record<string, unknown>), label: 'Twin', fields: ['title'] };
    const app = policyApp({ packs: [...policyApp().packs, twin] });
    const door = fakeDoor(app);
    const named = await refusalOf(executeGetRecordContext({ ...CALL, context: 'policy_document' }, door));
    const bare = await refusalOf(run(app));
    expect(named).toEqual(bare);
    expect(named).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(named.message).toContain("'policy_document'");
    expect(door.reads).toEqual([]);
    expect(await recordContextReadSet({ objectName: 'policy', context: 'policy_document' }, door)).toEqual({ objects: ['policy'] });
  });

  it('3. a duplicated name beside another pack: the several answer lists each pack; naming another pack still reads it', async () => {
    const twin = { ...(policyApp().packs[0] as Record<string, unknown>), label: 'Twin' };
    const brief = { name: 'policy_brief', label: 'Brief', object: 'policy', fields: ['title'] };
    const app = policyApp({ packs: [...policyApp().packs, twin, brief] });
    const several = await refusalOf(run(app));
    expect(several).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    for (const listed of ['policy_brief ("Brief")', 'policy_document ("Policy document")', 'policy_document ("Twin")']) {
      expect(several.message).toContain(listed);
    }
    const twins = await refusalOf(run(app, { ...CALL, context: 'policy_document' }));
    expect(twins).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    const read = await executeGetRecordContext({ ...CALL, context: 'policy_brief' }, fakeDoor(app));
    expect(read.data).toBeDefined();
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

describe('get_record_context — object level: a gate that refuses everyone refuses the whole call, within the naming bound (ADR-0160 D3/D4)', () => {
  /** The fixture pack with a second, served related child (`claim`) beside `policy_revision`. */
  const twoChildren = (overrides: Partial<FakeApp> = {}): FakeApp => {
    const app = policyApp(overrides);
    app.packs = [{
      name: 'policy_document',
      label: 'Policy document',
      object: 'policy',
      fields: ['title'],
      related: [
        { object: 'policy_revision', field: 'policy', fields: ['version'] },
        { object: 'claim', field: 'policy', fields: ['number'] },
      ],
    }];
    return app;
  };

  it('[as amended] a child this caller is not served is left out: the root and the served child, ONE not-visible statement, the child named nowhere', async () => {
    const door = fakeDoor(twoChildren({ unservedObjects: ['policy_revision'] }));
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.fields.map((f) => f.name)).toEqual(['title']);
    expect(out.data.related!.map((l) => l.object)).toEqual(['claim']);
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['c1']);
    expect(out.notes).toEqual([{ kind: 'not_visible', text: sentencesFor([]).notVisible }]);
    const text = JSON.stringify(out);
    expect(text).not.toContain('policy_revision');
    expect(text).not.toContain('Policy revision');
    // Nothing of the child is read after its object-level judgement, its published definition included.
    expect(door.asked.filter((a) => a.object === 'policy_revision').map((a) => a.member))
      .toEqual(['readGuard', 'assertApiExposed', 'servedObjectDefinitionOf']);
    // Control: served, both children answer and nothing is stated.
    const control = await run(twoChildren());
    expect(control.data.related!.map((l) => l.object)).toEqual(['policy_revision', 'claim']);
    expect(control.notes).toEqual([]);
  });

  it('[as amended] a lookup target reached only through a left-out child is not judged: it refuses nothing', async () => {
    const app = twoChildren({ unservedObjects: ['policy_revision'], guardedObjects: ['account'] });
    (app.packs[0] as { related: Array<{ fields: string[] }> }).related[0].fields = ['version', 'reviewer'];
    const door = fakeDoor(app);
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related!.map((l) => l.object)).toEqual(['claim']);
    expect(door.asked).not.toContainEqual({ member: 'readGuard', object: 'account' });
  });

  it('a child API exposure refuses whose caller is not served it either is refused unnamed (the naming bound)', async () => {
    const refused = await refusalOf(run(twoChildren({ unexposedObjects: ['policy_revision'], unservedObjects: ['policy_revision'] })));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toContain('policy_document');
    expect(refused.message).not.toContain('policy_revision');
  });

  it('a disabled-package child is refused whole, before its served definition is asked: a disabled package serves its object to nobody', async () => {
    const door = fakeDoor(twoChildren({ unservedObjects: ['policy_revision'] }));
    const exposedOf = door.assertApiExposed.bind(door);
    door.assertApiExposed = async (object, action) => {
      if (object === 'policy_revision') {
        door.asked.push({ member: 'assertApiExposed', object });
        throw Object.assign(new Error(`Object '${object}' belongs to a disabled package`), { code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
      }
      return exposedOf(object, action);
    };
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).not.toContain('policy_revision');
    expect(refused.message).not.toContain('disabled package');
    expect(door.asked).not.toContainEqual({ member: 'servedObjectDefinitionOf', object: 'policy_revision' });
    expect(door.reads).toEqual([]);
  });

  it('a served-definition read that throws a coded refusal refuses the call unnamed, never left out', async () => {
    const door = fakeDoor(twoChildren());
    const servedOf = door.servedObjectDefinitionOf.bind(door);
    door.servedObjectDefinitionOf = async (object) => {
      if (object === 'policy_revision') {
        throw Object.assign(new Error(`Object '${object}' not found`), { code: 'OBJECT_NOT_FOUND', status: 404 });
      }
      return servedOf(object);
    };
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).not.toContain('policy_revision');
    expect(door.reads).toEqual([]);
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
      policyApp({ unexposedObjects: ['policy_revision'] }),
    ]) {
      const door = fakeDoor(app);
      await refusalOf(executeGetRecordContext(CALL, door));
      expect(door.asked).not.toContainEqual({ member: 'publishedObjectDefinitionOf', object: 'policy_revision' });
    }
    // [as amended] A child left out for this caller is not read either.
    const leftOut = fakeDoor(policyApp({ unservedObjects: ['policy_revision'] }));
    await executeGetRecordContext(CALL, leftOut);
    expect(leftOut.asked).not.toContainEqual({ member: 'publishedObjectDefinitionOf', object: 'policy_revision' });
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

describe('get_record_context — a read of a related object that fails is a failure, not a refusal (ADR-0112, ADR-0160 D3 "Object level")', () => {
  /** What the outage says: every name in it is one the caller is not shown. */
  const OUTAGE = 'store down: policy_revision.secret_note in package acme_private';
  const outage = () => new Error(OUTAGE);

  /** The thrown failure, with what it must not carry. */
  async function failureOf(promise: Promise<unknown>): Promise<{ code: string; status: number; message: string; cause: unknown }> {
    try {
      await promise;
    } catch (err) {
      const e = err as { code: string; status: number; message: string; cause: unknown };
      return { code: e.code, status: e.status, message: e.message, cause: e.cause };
    }
    throw new Error('expected a failure');
  }

  /** A door whose `member` throws `thrown()` for `policy_revision`, and answers as the fixture otherwise. */
  const throwingAt = (
    member: 'assertApiExposed' | 'servedObjectDefinitionOf' | 'publishedObjectDefinitionOf' | 'query',
    thrown: () => unknown,
    app: FakeApp = policyApp(),
  ) => {
    const door = fakeDoor(app);
    const real = (door[member] as (...a: unknown[]) => Promise<unknown>).bind(door);
    (door as unknown as Record<string, unknown>)[member] = async (object: string, ...rest: unknown[]) => {
      if (object === 'policy_revision') throw thrown();
      return real(object, ...rest);
    };
    return door;
  };

  /** The failure's answer: `SERVICE_UNAVAILABLE` 503, naming the pack and the root and nothing the outage said. */
  const expectFailureNamingNothing = (failed: Awaited<ReturnType<typeof failureOf>>, original: unknown) => {
    expect(failed).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(failed.message).toBe(sentencesFor([]).readFailed('policy_document', 'policy'));
    for (const word of ['policy_revision', 'secret_note', 'acme_private', 'store down']) {
      expect(failed.message).not.toContain(word);
    }
    // The original is the host's, on `cause` (which no door puts on the wire).
    expect(failed.cause).toBe(original);
  };

  it.each([
    ['step 4a: the API-exposure check', 'assertApiExposed'],
    ['step 4a: the served-definition read', 'servedObjectDefinitionOf'],
    ['publishedOf: the published-definition read', 'publishedObjectDefinitionOf'],
    ['the child list query', 'query'],
  ] as const)('%s throwing an uncoded error fails the call SERVICE_UNAVAILABLE, naming nothing', async (_site, member) => {
    const thrown = outage();
    const door = throwingAt(member, () => thrown);
    expectFailureNamingNothing(await failureOf(executeGetRecordContext(CALL, door)), thrown);
  });

  it.each([
    ['step 4a: the API-exposure check', 'assertApiExposed'],
    ['step 4a: the served-definition read', 'servedObjectDefinitionOf'],
    ['publishedOf: the published-definition read', 'publishedObjectDefinitionOf'],
  ] as const)('control, %s: a coded refusal (a disabled package\'s 404) stays PERMISSION_DENIED 403, unnamed', async (_site, member) => {
    const door = throwingAt(member, () =>
      Object.assign(new Error("Object 'policy_revision' belongs to a disabled package"), { code: 'OBJECT_PACKAGE_DISABLED', status: 404 }));
    const refused = await refusalOf(executeGetRecordContext(CALL, door));
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toBe(sentencesFor([]).objectRefusedUnnamed('policy_document', 'policy'));
  });

  it('control, the child list query: the door\'s own coded refusal of a served child is answered as the door wrote it', async () => {
    const refusal = Object.assign(new Error("Field 'version' cannot be filtered or sorted on"), { code: 'PERMISSION_DENIED', status: 403 });
    const door = throwingAt('query', () => refusal);
    await expect(executeGetRecordContext(CALL, door)).rejects.toBe(refusal);
  });

  it.each<[string, () => unknown]>([
    ['a driver errno on `.code` with no status', () => Object.assign(new Error(OUTAGE), { code: 'SQLITE_BUSY' })],
    ['a coded 5xx', () => Object.assign(new Error(OUTAGE), { code: 'SERVICE_UNAVAILABLE', status: 503 })],
    ['a status with no code', () => Object.assign(new Error(OUTAGE), { status: 404 })],
    ['a thrown value that is not an object', () => OUTAGE],
  ])('%s is a failure too, not a refusal', async (_label, thrown) => {
    let original: unknown;
    const door = throwingAt('servedObjectDefinitionOf', () => (original = thrown()));
    expectFailureNamingNothing(await failureOf(executeGetRecordContext(CALL, door)), original);
  });

  it('the failure sentence is written in the caller\'s locale', async () => {
    const door = throwingAt('publishedObjectDefinitionOf', outage, policyApp({ locales: ['zh-CN'] }));
    const failed = await failureOf(executeGetRecordContext(CALL, door));
    expect(failed.message).toBe(sentencesFor(['zh-CN']).readFailed('policy_document', 'policy'));
    expect(failed.message).not.toBe(sentencesFor([]).readFailed('policy_document', 'policy'));
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

  /**
   * [ADR-0160 D3: every cut is stated] A door whose page cap is below the cut
   * plus its probe row: this fake cuts a larger page silently, the way a door
   * that clamps would, so without its cap the executor would carry a cut list
   * as whole.
   */
  const cappedDoor = (app: FakeApp, cap: number | undefined) => {
    const door = fakeDoor(app);
    const queryOf = door.query.bind(door);
    door.query = async (object, opts) =>
      queryOf(object, { ...opts, ...(cap !== undefined && typeof opts.limit === 'number' ? { limit: Math.min(opts.limit, cap) } : {}) });
    door.pageCap = () => cap;
    return door;
  };
  const longApp = (rows: number) => {
    const app = policyApp();
    app.records.policy_revision = Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, version: `v${i}`, policy: 'p1', reviewer: 'a1', note: 'n' }));
    return app;
  };

  it('a door whose page cap is below the cut plus its probe row is asked for at most its cap; the list is cut one row under it, and stated', async () => {
    const door = cappedDoor(longApp(25), 5);
    const out = await executeGetRecordContext(CALL, door);
    const list = out.data.related![0];
    expect(list.rows).toHaveLength(4);
    expect(list.truncated).toBe(true);
    expect(out.notes).toEqual([
      { kind: 'related_truncated', object: 'policy_revision', text: sentencesFor([]).relatedTruncated('policy_revision', 4) },
    ]);
    const listRead = door.reads.find((r) => r.member === 'query' && r.object === 'policy_revision');
    expect((listRead?.opts as { limit: number }).limit).toBe(5);
    // A list that fits under the door's cap is carried whole, with nothing stated.
    const short = await executeGetRecordContext(CALL, cappedDoor(longApp(4), 5));
    expect(short.data.related![0].rows).toHaveLength(4);
    expect(short.data.related![0].truncated).toBeUndefined();
    expect(short.notes).toEqual([]);
  });

  it('a door cap at or above the cut plus its probe row, or no answer, changes nothing', async () => {
    for (const cap of [RECORD_CONTEXT_RELATED_MAX_ROWS + 1, 500, undefined, 0, 2.5]) {
      const door = fakeDoor(longApp(25));
      door.pageCap = () => cap;
      const out = await executeGetRecordContext(CALL, door);
      expect(out.data.related![0].rows).toHaveLength(RECORD_CONTEXT_RELATED_MAX_ROWS);
      const listRead = door.reads.find((r) => r.member === 'query' && r.object === 'policy_revision');
      expect((listRead?.opts as { limit: number }).limit).toBe(RECORD_CONTEXT_RELATED_MAX_ROWS + 1);
    }
  });

  it('a list the agent ceiling narrowed carries the security service\'s own sentence', async () => {
    const out = await run(policyApp({ narrowed: { policy_revision: 'Narrowed by the agent ceiling.' } }));
    expect(out.notes).toEqual([{ kind: 'narrowed', object: 'policy_revision', text: 'Narrowed by the agent ceiling.' }]);
  });
});

/**
 * [ADR-0160 D1/D3/D4, second amendment] A related list's `where`, `orderBy`
 * and `limit`: run inside the one capped child query, as the caller; a field
 * they name that the caller cannot query on drops the section, stated and
 * never named; one the definition lacks leaves it out silently; the read set
 * does not move.
 */
describe('get_record_context — a related list\'s where, orderBy and limit (ADR-0160 second amendment)', () => {
  /** policy_revision with `is_current`, `sort_no` and a masked `reviewer_email`; three rows on p1, one on p2. */
  function filteredApp(entry: Record<string, unknown>, overrides: Partial<FakeApp> = {}): FakeApp {
    const app = policyApp(overrides);
    const revision = app.objects.policy_revision as { fields: Record<string, Record<string, unknown>> };
    revision.fields.is_current = { name: 'is_current', type: 'boolean', label: 'Current' };
    revision.fields.sort_no = { name: 'sort_no', type: 'number', label: 'Sort number' };
    revision.fields.reviewer_email = {
      name: 'reviewer_email', type: 'email', label: 'Reviewer email', maskingRule: { strategy: 'partial' },
    };
    app.records.policy_revision = [
      { id: 'r1', version: 'v1', policy: 'p1', is_current: true, sort_no: 2, reviewer_email: 'a@x.io' },
      { id: 'r2', version: 'v2', policy: 'p1', is_current: true, sort_no: 1, reviewer_email: 'b@x.io' },
      { id: 'r3', version: 'v3', policy: 'p1', is_current: false, sort_no: 3, reviewer_email: 'c@x.io' },
      { id: 'r9', version: 'v9', policy: 'p2', is_current: true, sort_no: 0, reviewer_email: 'd@x.io' },
    ];
    app.packs = [{
      name: 'policy_document',
      label: 'Policy document',
      object: 'policy',
      fields: ['title'],
      related: [{ object: 'policy_revision', field: 'policy', fields: ['version'], ...entry }],
    }];
    return app;
  }
  const listReads = (door: ReturnType<typeof fakeDoor>) =>
    door.reads.filter((r) => r.member === 'query' && r.object === 'policy_revision');

  it('filter and order applied in ONE capped query, cut at the limit, and the cut is stated', async () => {
    const where = { is_current: { $eq: true } };
    const door = fakeDoor(filteredApp({ where, orderBy: [{ field: 'sort_no', order: 'asc' }], limit: 1 }));
    const out = await executeGetRecordContext(CALL, door);
    const list = out.data.related![0];
    expect(list.rows.map((r) => r.id)).toEqual(['r2']);
    expect(list.truncated).toBe(true);
    expect(out.notes).toEqual([
      { kind: 'related_truncated', object: 'policy_revision', text: sentencesFor([]).relatedTruncated('policy_revision', 1) },
    ]);
    const reads = listReads(door);
    expect(reads).toHaveLength(1);
    expect(reads[0].opts).toMatchObject({
      where: { $and: [{ policy: 'p1' }, where] },
      orderBy: [{ field: 'sort_no', order: 'asc' }],
      limit: 2,
    });
  });

  it('a bare value reads as $eq; a list within its limit is not cut; descending order is kept', async () => {
    const out = await run(filteredApp({ where: { is_current: true }, orderBy: [{ field: 'sort_no', order: 'desc' }], limit: 5 }));
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(out.data.related![0].truncated).toBeUndefined();
    expect(out.notes).toEqual([]);
  });

  it('the filter grants nothing: a row the caller\'s row rules hide stays absent though it matches', async () => {
    const out = await run(filteredApp({ where: { is_current: true } }, { unreadableRows: ['r2'] }));
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r1']);
    expect(JSON.stringify(out)).not.toContain('r2');
  });

  it('no where reaches another root\'s rows: it is joined to the link with $and', async () => {
    const out = await run(filteredApp({ where: { $or: [{ is_current: true }, { version: 'v9' }] } }));
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it.each<[string, Record<string, unknown>, Partial<FakeApp>]>([
    ['a where field outside the caller\'s queryable fields', { where: { sort_no: { $gt: 0 } } }, { unqueryableFields: { policy_revision: ['sort_no'] } }],
    ['an orderBy field outside the caller\'s queryable fields', { orderBy: [{ field: 'sort_no', order: 'asc' }] }, { unqueryableFields: { policy_revision: ['sort_no'] } }],
    ['a where field the caller\'s schema hides', { where: { $and: [{ is_current: true }, { sort_no: 1 }] } }, { hiddenFields: { policy_revision: ['sort_no'] } }],
    ['an orderBy field field-level security withholds', { orderBy: [{ field: 'sort_no', order: 'desc' }] }, { withheldFields: { policy_revision: ['sort_no'] } }],
  ])('%s drops the whole section with the one not-visible statement, never naming it and never refusing', async (_label, entry, overrides) => {
    const door = fakeDoor(filteredApp(entry, overrides));
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related).toBeUndefined();
    expect(out.notes).toEqual([{ kind: 'not_visible', text: sentencesFor([]).notVisible }]);
    const text = JSON.stringify(out);
    expect(text).not.toContain('sort_no');
    expect(text).not.toContain('Sort number');
    expect(listReads(door)).toEqual([]);
  });

  it('control: the same where and orderBy on fields the caller can query on read the list', async () => {
    const out = await run(filteredApp({ where: { sort_no: { $gt: 0 } }, orderBy: [{ field: 'sort_no', order: 'asc' }] }));
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
    expect(out.notes).toEqual([]);
  });

  it('with no queryable answer, a field that declares a masking rule is never filtered or sorted on (the contract\'s fallback)', async () => {
    const door = fakeDoor(filteredApp({ orderBy: [{ field: 'reviewer_email', order: 'asc' }] }, { noQueryableAnswer: true }));
    expect(door.queryableFieldsOf).toBeUndefined();
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related).toBeUndefined();
    expect(out.notes.map((n) => n.kind)).toEqual(['not_visible']);
    expect(JSON.stringify(out)).not.toContain('reviewer_email');
    expect(listReads(door)).toEqual([]);
    // Control: an unmasked field under the same fallback reads.
    const control = await run(filteredApp({ orderBy: [{ field: 'sort_no', order: 'asc' }] }, { noQueryableAnswer: true }));
    expect(control.data.related![0].rows.map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
  });

  it('a queryable-fields probe that throws judges nothing: the section is dropped and stated, never read on a guess', async () => {
    const door = fakeDoor(filteredApp({ where: { is_current: true } }));
    door.queryableFieldsOf = async () => { throw new Error('security service down'); };
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related).toBeUndefined();
    expect(out.notes.map((n) => n.kind)).toEqual(['not_visible']);
    expect(listReads(door)).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a where field', { where: { is_curent: true } }],
    ['an orderBy field', { orderBy: [{ field: 'sortno', order: 'asc' }] }],
  ])('%s the definition lacks is an author defect: the section is left out, nothing stated, never read without it', async (_label, entry) => {
    const door = fakeDoor(filteredApp(entry));
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related).toBeUndefined();
    expect(out.notes).toEqual([]);
    expect(listReads(door)).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['declares `sortable: false`', { name: 'notes_rank', type: 'number', label: 'Notes rank', sortable: false }],
    ['is a formula', { name: 'notes_rank', type: 'formula', label: 'Notes rank', expression: 'sort_no * 2' }],
  ])('an orderBy field that %s is not offered as a sort: an author defect, the section left out, nothing stated, the door never asked', async (_label, def) => {
    const app = filteredApp({ orderBy: [{ field: 'notes_rank', order: 'asc' }] });
    (app.objects.policy_revision as { fields: Record<string, unknown> }).fields.notes_rank = def;
    const door = fakeDoor(app);
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related).toBeUndefined();
    expect(out.notes).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('notes_rank');
    expect(listReads(door)).toEqual([]);
    // The door this judgement keeps the call from: the same order handed to it is refused whole.
    await expect(door.query('policy_revision', { where: { policy: 'p1' }, orderBy: [{ field: 'notes_rank', order: 'asc' }] }))
      .rejects.toMatchObject({ code: 'INVALID_SORT', status: 400 });
    // The root's own answer is untouched.
    expect(out.data.fields.map((f) => f.name)).toEqual(['title']);
  });

  it('control: a where on a field that is not offered as a sort still reads; only an order on it is judged', async () => {
    const app = filteredApp({ where: { notes_rank: { $gt: 0 } }, orderBy: [{ field: 'sort_no', order: 'asc' }] });
    (app.objects.policy_revision as { fields: Record<string, unknown> }).fields.notes_rank = {
      name: 'notes_rank', type: 'number', label: 'Notes rank', sortable: false,
    };
    app.records.policy_revision = app.records.policy_revision.map((r) => ({ ...r, notes_rank: r.sort_no }));
    const out = await run(app);
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
    expect(out.notes).toEqual([]);
  });

  it('an orderBy on a registry-injected field (`created_at`) that both definitions carry reads the list in that order', async () => {
    const app = filteredApp({ orderBy: [{ field: 'created_at', order: 'desc' }] });
    (app.objects.policy_revision as { fields: Record<string, unknown> }).fields.created_at = {
      name: 'created_at', type: 'datetime', label: 'Created at', readonly: true,
    };
    app.records.policy_revision = app.records.policy_revision.map((r, i) => ({ ...r, created_at: `2026-11-0${i + 1}T00:00:00Z` }));
    const door = fakeDoor(app);
    const out = await executeGetRecordContext(CALL, door);
    expect(out.data.related![0].rows.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
    expect(out.notes).toEqual([]);
    expect(listReads(door)[0].opts).toMatchObject({ orderBy: [{ field: 'created_at', order: 'desc' }] });
  });

  it('the read set is the same with and without the three keys', async () => {
    const metadataOf = (app: FakeApp) => ({
      listContextPacks: async () => app.packs,
      publishedObjectDefinitionOf: async (name: string) => app.objects[name] ?? null,
    });
    const plain = filteredApp({ fields: ['version', 'reviewer'] });
    const keyed = filteredApp({
      fields: ['version', 'reviewer'],
      where: { $or: [{ is_current: true }, { sort_no: { $in: [1, 2] } }] },
      orderBy: [{ field: 'sort_no', order: 'desc' }],
      limit: 3,
    });
    const without = await recordContextReadSet({ objectName: 'policy' }, metadataOf(plain));
    expect(without).toEqual({ pack: 'policy_document', objects: ['policy', 'policy_revision', 'account'] });
    expect(await recordContextReadSet({ objectName: 'policy' }, metadataOf(keyed))).toEqual(without);
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

describe('get_record_context — the outline bound (ADR-0160 D3: every cut is stated)', () => {
  const HEADINGS = 300;
  /** A long body of many short headings, each over a short clause. */
  const manyHeadings = () => Array.from({ length: HEADINGS }, (_, i) => `## Clause ${i + 1}\nThe insurer pays clause ${i + 1}.\n`).join('');
  const withBody = (content: string, locales?: string[]) => {
    const app = policyApp(locales ? { locales } : {});
    app.records.policy[0].content = content;
    return app;
  };

  it('a body of many short headings lists the cap, and one note says how many headings were left out', async () => {
    const content = manyHeadings();
    expect(content.length).toBeGreaterThan(RECORD_CONTEXT_BODY_MAX_CHARS);
    const out = await run(withBody(content));
    expect(GetRecordContextOutputSchema.safeParse(out).success).toBe(true);
    const outline = out.data.body?.outline ?? [];
    expect(outline).toHaveLength(RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
    expect(outline[0]).toEqual({ anchor: 'clause-1', heading: 'Clause 1', level: 2 });
    expect(JSON.stringify(outline).length).toBeLessThanOrEqual(RECORD_CONTEXT_BODY_MAX_CHARS);
    expect(out.notes.map((n) => n.kind)).toEqual(['body_outline', 'outline_truncated']);
    const cut = out.notes[1];
    expect(cut.text).toContain(String(HEADINGS - RECORD_CONTEXT_OUTLINE_MAX_ENTRIES));
    expect(cut.text).toContain(String(HEADINGS));
    expect(cut.text).not.toContain('insurer');
  });

  it('states the cut in the caller\'s locale', async () => {
    const out = await run(withBody(manyHeadings(), ['zh-CN']));
    const cut = out.notes.find((n) => n.kind === 'outline_truncated');
    expect(cut?.text).toContain(String(HEADINGS - RECORD_CONTEXT_OUTLINE_MAX_ENTRIES));
    expect(cut?.text).toMatch(/大纲/);
  });

  it('the cap bounds the listing, not which sections exist: an unlisted heading\'s anchor reads its section', async () => {
    const out = await run(withBody(manyHeadings()), { ...CALL, anchor: `clause-${HEADINGS}` });
    expect(out.data.body).toEqual({
      field: 'content',
      label: 'Content',
      anchor: `clause-${HEADINGS}`,
      text: `## Clause ${HEADINGS}\nThe insurer pays clause ${HEADINGS}.\n`,
    });
    expect(out.notes).toEqual([]);
  });

  it('a body whose only heading is too long to list is carried to the bound and marked truncated', async () => {
    const out = await run(withBody(`# ${'x'.repeat(RECORD_CONTEXT_BODY_MAX_CHARS)}\nbody`));
    expect(out.data.body?.outline).toBeUndefined();
    expect(out.data.body?.text).toHaveLength(RECORD_CONTEXT_BODY_MAX_CHARS);
    expect(out.data.body?.truncated).toBe(true);
    expect(out.notes.map((n) => n.kind)).toEqual(['body_truncated']);
  });
});

describe('get_record_context — the outline in pages (ADR-0160 D3: every section reachable, every answer bounded)', () => {
  const HEADINGS = 300;
  /** A long body of `n` short headings at one level, each over a short clause. */
  const flat = (n = HEADINGS) => Array.from({ length: n }, (_, i) => `## Clause ${i + 1}\nThe insurer pays clause ${i + 1}.\n`).join('');
  /** One top heading over `n` second-level ones: a nested cut whose top section passes the body bound. */
  const nested = (n = HEADINGS) => `# Terms\n${flat(n)}`;
  const withBody = (content: string, overrides: Partial<FakeApp> = {}) => {
    const app = policyApp(overrides);
    app.records.policy[0].content = content;
    return app;
  };
  /** The answer's one JSON, held to the bounds a single answer keeps. */
  const assertBounded = (out: Awaited<ReturnType<typeof run>>) => {
    expect(GetRecordContextOutputSchema.safeParse(out).success).toBe(true);
    const body = out.data.body!;
    if (body.outline) {
      expect(body.outline.length).toBeLessThanOrEqual(RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
      expect(JSON.stringify(body.outline).length).toBeLessThanOrEqual(RECORD_CONTEXT_BODY_MAX_CHARS);
    }
    if (body.text !== undefined) expect(body.text.length).toBeLessThanOrEqual(RECORD_CONTEXT_BODY_MAX_CHARS);
  };
  /** Every page, from the first, by the `outlineNext` each answer gave. */
  const walk = async (app: FakeApp) => {
    const pages: Array<Awaited<ReturnType<typeof run>>> = [];
    let from: number | undefined;
    do {
      const out = await run(app, from === undefined ? CALL : { ...CALL, outlineFrom: from });
      assertBounded(out);
      pages.push(out);
      from = out.data.body?.outlineNext;
    } while (from !== undefined && pages.length <= HEADINGS);
    return pages;
  };

  it('a body of 300 headings at one level: every section is read by an anchor the tool issued, each answer within the bounds', async () => {
    const content = flat();
    expect(content.length).toBeGreaterThan(RECORD_CONTEXT_BODY_MAX_CHARS);
    const app = withBody(content);
    const pages = await walk(app);
    expect(pages.length).toBeGreaterThan(1);
    const issued = pages.flatMap((p) => p.data.body?.outline ?? []).map((h) => h.anchor);
    expect(issued).toHaveLength(HEADINGS);
    expect(new Set(issued).size).toBe(HEADINGS);
    for (const [i, anchor] of issued.entries()) {
      const section = await run(app, { ...CALL, anchor });
      assertBounded(section);
      expect(section.data.body?.text).toBe(`## Clause ${i + 1}\nThe insurer pays clause ${i + 1}.\n`);
    }
  });

  it('a nested body whose top section passes the bound: the deeper headings are listed on later pages, each read by its anchor', async () => {
    const app = withBody(nested());
    const pages = await walk(app);
    expect(pages[0].data.body?.outline?.[0]).toEqual({ anchor: 'terms', heading: 'Terms', level: 1 });
    const issued = pages.flatMap((p) => p.data.body?.outline ?? []).map((h) => h.anchor);
    expect(issued).toHaveLength(HEADINGS + 1);
    // The top section is cut at the bound, so its clauses past the cut are reached by their own anchors only.
    const top = await run(app, { ...CALL, anchor: 'terms' });
    expect(top.data.body?.truncated).toBe(true);
    expect(top.data.body?.text).not.toContain(`Clause ${HEADINGS}\n`);
    const last = await run(app, { ...CALL, anchor: `clause-${HEADINGS}` });
    expect(last.data.body?.text).toBe(`## Clause ${HEADINGS}\nThe insurer pays clause ${HEADINGS}.\n`);
  });

  it('the cut note is true for a flat cut and for a nested cut, in en and zh-Hans: it names the page to list next, not the headings under a section', async () => {
    for (const content of [flat(), nested()]) {
      const total = headingsOf(content, false).length;
      for (const locales of [undefined, ['zh-CN']]) {
        const out = await run(withBody(content, locales ? { locales } : {}));
        const listed = out.data.body?.outline?.length ?? 0;
        expect(out.data.body?.outlineNext).toBe(listed);
        const notes = out.notes.filter((n) => n.kind === 'outline_truncated');
        expect(notes).toHaveLength(1);
        const text = notes[0].text;
        for (const n of [listed, total, total - listed]) expect(text).toContain(String(n));
        expect(text).toContain(`outlineFrom ${listed}`);
        expect(text).not.toContain('insurer');
        // The sentence the flat cut made false: nothing it leaves out is under a listed section there.
        expect(text).not.toMatch(/includes the headings under it|它下面的标题包含在该章节的文本中/);
        if (locales) expect(text).toMatch(/大纲/);
      }
    }
  });

  it('the last page states that no later page lists more, and gives no outlineNext', async () => {
    const app = withBody(flat());
    const pages = await walk(app);
    const last = pages[pages.length - 1];
    expect(last.data.body).not.toHaveProperty('outlineNext');
    const cut = last.notes.find((n) => n.kind === 'outline_truncated');
    expect(cut?.text).toContain(String(HEADINGS - (last.data.body?.outline?.length ?? 0)));
    expect(cut?.text).not.toContain('outlineFrom');
  });

  it('a section listed on page 2 is read exactly as that page\'s body_outline note says, in en and zh-Hans; the same arguments plus the anchor are the control, refused', async () => {
    for (const locales of [undefined, ['zh-CN']]) {
      const app = withBody(flat(), locales ? { locales } : {});
      const first = await run(app);
      const page2Args = { ...CALL, outlineFrom: first.data.body!.outlineNext! };
      const page2 = await run(app, page2Args);
      const note = page2.notes.find((n) => n.kind === 'body_outline')!.text;
      // The note names what to repeat and that outlineFrom is left out.
      for (const word of ['objectName', 'recordId', 'context', 'anchor', 'outlineFrom']) expect(note).toContain(word);
      const anchor = page2.data.body!.outline![0].anchor;
      // As the note says: the record's arguments, the anchor, no outlineFrom.
      const { outlineFrom: _dropped, ...asTheNoteSays } = page2Args;
      const section = await run(app, { ...asTheNoteSays, anchor });
      expect(section.data.body).toMatchObject({ anchor, text: expect.stringMatching(/^## Clause \d+\n/) });
      // Control: "the same arguments" of page 2 plus the anchor is the refused pair.
      expect(await refusalOf(run(app, { ...page2Args, anchor }))).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
  });

  it('a count of headings too long to list reads in the singular for one and the plural for more', async () => {
    const tooLong = (n: number) => Array.from({ length: n }, (_, i) => `## ${'x'.repeat(RECORD_CONTEXT_BODY_MAX_CHARS)}${i}\n`).join('');
    const one = await run(withBody(tooLong(1) + flat()));
    expect(one.notes.find((n) => n.kind === 'outline_truncated')?.text).toContain('1 heading is too long for any page to list, so its anchor is not given.');
    const two = await run(withBody(tooLong(2) + flat()));
    expect(two.notes.find((n) => n.kind === 'outline_truncated')?.text).toContain('2 headings are too long for any page to list, so their anchors are not given.');
  });

  it('outlineFrom 0 is the first page', async () => {
    const app = withBody(flat());
    expect(await run(app, { ...CALL, outlineFrom: 0 })).toEqual(await run(app));
  });

  it('an outline page that does not start where outlineFrom says is ONE answer: past the end, a body carried whole, no body in the pack, or a body the caller cannot see', async () => {
    const past = await refusalOf(run(withBody(flat()), { ...CALL, outlineFrom: HEADINGS }));
    const whole = await refusalOf(run(policyApp(), { ...CALL, outlineFrom: HEADINGS }));
    const noBody = await refusalOf(
      run(policyApp({ packs: [{ name: 'policy_document', label: 'Policy document', object: 'policy', fields: ['title'] }] }), {
        ...CALL,
        outlineFrom: HEADINGS,
      }),
    );
    const hiddenBody = await refusalOf(run(policyApp({ hiddenFields: { policy: ['content'] } }), { ...CALL, outlineFrom: HEADINGS }));
    expect(past).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(past.message).toContain(String(HEADINGS));
    expect(whole).toEqual(past);
    expect(noBody).toEqual(past);
    expect(hiddenBody).toEqual(past);
  });

  it('a call naming both anchor and outlineFrom is refused before anything is read', async () => {
    const app = withBody(flat());
    const door = fakeDoor(app);
    const pair = { ...CALL, anchor: 'clause-1', outlineFrom: 80 };
    // The spec's schema admits the pair (record-context-tools.zod.test.ts); the executor refuses it.
    expect(GetRecordContextInputSchema.safeParse(pair).success).toBe(true);
    const refused = await refusalOf(executeGetRecordContext(pair, door));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(door.reads).toEqual([]);
  });

  it('a negative or fractional outlineFrom is refused at parse', async () => {
    for (const outlineFrom of [-1, 1.5, '80']) {
      expect(await refusalOf(run(withBody(flat()), { ...CALL, outlineFrom }))).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
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

/**
 * [ADR-0150 addendum 2026-11-25, reader 1] A pack is identified by
 * `(package, name)` (bucket 3, beside `skill`). Among the packs rooted on
 * `objectName`, `context` is read as a skill prompt's name is: a face
 * (`NS-NAME`) answers its one pack; a bare name resolves by ADR-0150 D3 for a
 * caller with no package — the environment's own pack, else the one package
 * holder, else `409` naming each candidate by its face. With `context`
 * omitted, the several answer lists each pack by its face with its label
 * (ADR-0160 D4 step 3, as amended 2026-11-25).
 */
describe('get_record_context — pack selection by (package, name) (ADR-0150 addendum 2026-11-25)', () => {
  const CRM = 'com.acme.crm';
  const HR = 'com.acme.hr';
  const NAMESPACES = { [CRM]: 'crm', [HR]: 'hr' };
  const brief = (packageId: string | undefined, label: string, object = 'policy') => ({
    name: 'brief',
    label,
    object,
    fields: ['title'],
    ...(packageId !== undefined ? { _packageId: packageId } : {}),
  });
  const twoHolders = (overrides: Partial<FakeApp> = {}) =>
    policyApp({ packs: [brief(CRM, 'Sales brief'), brief(HR, 'People brief')], namespaces: NAMESPACES, ...overrides });

  it('two packages each ship a pack of one name on one root: each is reached by its face', async () => {
    const crm = await run(twoHolders(), { ...CALL, context: 'crm-brief' });
    const hr = await run(twoHolders(), { ...CALL, context: 'hr-brief' });
    expect(crm.data.pack).toEqual({ name: 'brief', label: 'Sales brief' });
    expect(hr.data.pack).toEqual({ name: 'brief', label: 'People brief' });
  });

  it('the bare name two packages hold is refused 409, naming both faces, and nothing is read', async () => {
    const door = fakeDoor(twoHolders());
    const refused = await refusalOf(executeGetRecordContext({ ...CALL, context: 'brief' }, door));
    expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(refused.message).toContain('crm-brief');
    expect(refused.message).toContain('hr-brief');
    expect(door.reads).toEqual([]);
  });

  it('uninstalling one holder keeps the other: its face and the bare name both reach it', async () => {
    const left = policyApp({ packs: [brief(CRM, 'Sales brief')], namespaces: NAMESPACES });
    expect((await run(left, { ...CALL, context: 'crm-brief' })).data.pack.label).toBe('Sales brief');
    expect((await run(left, { ...CALL, context: 'brief' })).data.pack.label).toBe('Sales brief');
    expect(await refusalOf(run(left, { ...CALL, context: 'hr-brief' }))).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('the bare name resolves to the environment\'s own pack first; the package\'s is reached by its face', async () => {
    const app = policyApp({ packs: [brief(CRM, 'Sales brief'), brief(undefined, 'Our brief')], namespaces: NAMESPACES });
    expect((await run(app, { ...CALL, context: 'brief' })).data.pack.label).toBe('Our brief');
    expect((await run(app, { ...CALL, context: 'crm-brief' })).data.pack.label).toBe('Sales brief');
  });

  it('a package-less row\'s `sys_metadata` stamp is the environment, not a package', async () => {
    const app = policyApp({
      packs: [brief(CRM, 'Sales brief'), { ...brief(undefined, 'Our brief'), _packageId: 'sys_metadata' }],
      namespaces: NAMESPACES,
    });
    expect((await run(app, { ...CALL, context: 'brief' })).data.pack.label).toBe('Our brief');
  });

  it('the root narrows before D3 picks: a holder whose pack roots on another object is no candidate', async () => {
    const app = policyApp({ packs: [brief(CRM, 'Sales brief'), brief(HR, 'People brief', 'claim')], namespaces: NAMESPACES });
    expect((await run(app, { ...CALL, context: 'brief' })).data.pack.label).toBe('Sales brief');
    const elsewhere = await refusalOf(run(app, { ...CALL, context: 'hr-brief' }));
    const nowhere = await refusalOf(run(app, { ...CALL, context: 'nowhere-brief' }));
    expect({ ...elsewhere, message: undefined }).toEqual({ ...nowhere, message: undefined });
    expect(elsewhere).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('with `context` omitted, the several answer spells each pack as its face, with its label', async () => {
    const refused = await refusalOf(run(twoHolders()));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refused.message).toContain('crm-brief ("Sales brief"), hr-brief ("People brief")');
  });

  it('the several answer in zh-Hans names each pack by its face with its label', async () => {
    const refused = await refusalOf(run(twoHolders({ locales: ['zh-CN'] })));
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refused.message).toContain('crm-brief（“Sales brief”）, hr-brief（“People brief”）');
  });

  it('a pack with no label is listed by its face alone, in both locales (the fallback)', () => {
    const packs = [{ face: 'crm-brief', label: 'Sales brief' }, { face: 'hr-brief', label: ' ' }];
    const en = sentencesFor(['en']).severalPacks('policy', packs);
    const zh = sentencesFor(['zh-Hans']).severalPacks('policy', packs);
    expect(en).toContain('crm-brief ("Sales brief"), hr-brief.');
    expect(zh).toContain('crm-brief（“Sales brief”）, hr-brief。');
  });

  it('a door that cannot place a package spells every pack by its bare name: a face two holders derive names each holder', async () => {
    const app = policyApp({ packs: [brief(CRM, 'Sales brief'), brief(HR, 'People brief')] });
    const named = await refusalOf(run(app, { ...CALL, context: 'brief' }));
    const omitted = await refusalOf(run(app));
    for (const refused of [named, omitted]) {
      expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
      expect(refused.message).toContain(CRM);
      expect(refused.message).toContain(HR);
    }
  });

  it('the read set names the selected pack by its face', async () => {
    const door = fakeDoor(twoHolders());
    expect(await recordContextReadSet({ objectName: 'policy', context: 'hr-brief' }, door)).toEqual({ pack: 'hr-brief', objects: ['policy'] });
    expect(await recordContextReadSet({ objectName: 'policy', context: 'brief' }, door)).toEqual({ objects: ['policy'] });
  });
});
