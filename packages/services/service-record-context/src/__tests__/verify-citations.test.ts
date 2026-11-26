// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D9, third amendment] The citation verifier: a citation survives
 * only when its quote is found in the data member of the answer
 * `get_record_context` gives the asking user for the citation's `object`,
 * `id`, `context` and `anchor`. Every refused call drops its citation (point
 * 23). Each "dropped" case below has a control leg that verifies the same
 * quote, or shows the text the answer carries, so a verifier that drops
 * everything cannot pass.
 */

import { describe, expect, it } from 'vitest';
import { RECORD_CITATIONS_MAX } from '@objectstack/spec/ai';
import { executeGetRecordContext, verifyRecordCitations, type VerifyingCall } from '../index.js';
import { fakeDoor, policyApp, type FakeApp, type FakeDoor } from './fake-door.js';

const ROOT = { object: 'policy', id: 'p1' };

/** The quotes that survive, in order. */
async function surviving(app: FakeApp, citations: unknown[]): Promise<string[]> {
  return (await verifyRecordCitations(citations, fakeDoor(app))).map((c) => c.quote);
}

const cite = (quote: string, extra: Record<string, unknown> = {}) => ({ ...ROOT, quote, ...extra });

describe('[ADR-0160 D9] what a quote is matched against', () => {
  it('verifies a field value, a display, and a lookup display', async () => {
    expect(await surviving(policyApp(), [cite('Fire cover'), cite('active'), cite('Active'), cite('Acme')])).toEqual([
      'Fire cover',
      'active',
      'Active',
      'Acme',
    ]);
  });

  it('verifies a quote found in a related-list cell, cited on the root record (Q3)', async () => {
    expect(await surviving(policyApp(), [cite('second')])).toEqual(['second']);
    // A row of another policy is not in this record's answer.
    expect(await surviving(policyApp(), [cite('other policy')])).toEqual([]);
  });

  it('refuses a quote that appears only in a note, the framing, or a label', async () => {
    const statement = 'Reads on policy revisions are narrowed by the agent ceiling.';
    const app = policyApp({ narrowed: { policy_revision: statement } });
    const answer = await executeGetRecordContext({ objectName: 'policy', recordId: 'p1' }, fakeDoor(app));
    // Control: the answer carries each of these strings outside the data strings.
    expect(answer.notes.map((n) => n.text)).toContain(statement);
    expect(answer.data.pack.label).toBe('Policy document');
    expect(answer.data.fields.map((f) => f.label)).toContain('Secret terms');
    expect(await surviving(app, [cite(statement), cite(answer.framing), cite('Policy document'), cite('Secret terms')])).toEqual([]);
  });

  it('refuses a quote from a field the caller has withheld or hidden', async () => {
    expect(await surviving(policyApp(), [cite('S3CRET-TERMS')])).toEqual(['S3CRET-TERMS']);
    expect(await surviving(policyApp({ withheldFields: { policy: ['secret_terms'] } }), [cite('S3CRET-TERMS')])).toEqual([]);
    expect(await surviving(policyApp({ hiddenFields: { policy: ['secret_terms'] } }), [cite('S3CRET-TERMS')])).toEqual([]);
  });

  it('does not match a value that is not a string', async () => {
    const answer = await executeGetRecordContext({ objectName: 'policy', recordId: 'p1' }, fakeDoor(policyApp()));
    expect(answer.data.fields.find((f) => f.name === 'premium')?.value).toBe(1200);
    expect(await surviving(policyApp(), [cite('1200')])).toEqual([]);
  });

  it('collapses whitespace runs and trims the quote; case and characters must agree', async () => {
    expect(await surviving(policyApp(), [cite('  Covers   fire.\n'), cite('Covers fire. ## Exclusions')])).toEqual([
      '  Covers   fire.\n',
      'Covers fire. ## Exclusions',
    ]);
    expect(await surviving(policyApp(), [cite('covers fire.'), cite('Covers fire!'), cite(' \n\t ')])).toEqual([]);
  });

  it('matches an html or richtext body also with its tags removed, and only such a body', async () => {
    const htmlApp = (type: string): FakeApp => {
      const app = policyApp();
      const policy = app.objects.policy as { fields: Record<string, Record<string, unknown>> };
      policy.fields.content = { ...policy.fields.content, type };
      app.records.policy[0].content = '<h1>Scope</h1><p>Covers <b>fire</b> damage.</p>';
      return app;
    };
    for (const type of ['html', 'richtext']) {
      expect(await surviving(htmlApp(type), [cite('Covers fire damage.'), cite('Covers <b>fire</b>')])).toEqual([
        'Covers fire damage.',
        'Covers <b>fire</b>',
      ]);
    }
    // Removing a tag joins the text on either side: the tag-removed reading is
    // not only stricter than matching as stored.
    const joined = htmlApp('html');
    joined.records.policy[0].content = '<p>Fire</p><p>cover</p>';
    expect(await surviving(joined, [cite('Firecover')])).toEqual(['Firecover']);
    expect(await surviving(htmlApp('markdown'), [cite('Covers fire damage.'), cite('Covers <b>fire</b>')])).toEqual([
      'Covers <b>fire</b>',
    ]);
  });
});

describe('[ADR-0160 D9] anchors', () => {
  it('verifies a quote in a section by its anchor, and refuses a stale anchor', async () => {
    expect(await surviving(policyApp(), [cite('Arson.', { anchor: 'exclusions' })])).toEqual(['Arson.']);
    expect(await surviving(policyApp(), [cite('Arson.', { anchor: 'old-exclusions' })])).toEqual([]);
    // The anchor scopes the match to its section.
    expect(await surviving(policyApp(), [cite('Call us.', { anchor: 'exclusions' })])).toEqual([]);
  });

  it('for a body that came back as an outline, refuses a quote cited without an anchor', async () => {
    const app = policyApp();
    app.records.policy[0].content = [
      '# Scope',
      `Covers fire. ${'Filler sentence for length. '.repeat(200)}`,
      '# Claims',
      `Call us within thirty days. ${'More filler for length. '.repeat(200)}`,
    ].join('\n');
    const answer = await executeGetRecordContext({ objectName: 'policy', recordId: 'p1' }, fakeDoor(app));
    expect(answer.data.body?.outline?.map((h) => h.anchor)).toEqual(['scope', 'claims']);
    expect(await surviving(app, [cite('Call us within thirty days.')])).toEqual([]);
    expect(await surviving(app, [cite('Call us within thirty days.', { anchor: 'claims' })])).toEqual(['Call us within thirty days.']);
  });
});

describe('[ADR-0160 D9] context (Q2)', () => {
  const twoPacks = (): FakeApp => {
    const app = policyApp();
    app.packs = [...app.packs, { name: 'policy_brief', label: 'Policy brief', object: 'policy', fields: ['title'] }];
    return app;
  };

  it('refuses a citation without context on an object with two packs, and verifies it on an object with one', async () => {
    expect(await surviving(twoPacks(), [cite('Fire cover')])).toEqual([]);
    expect(await surviving(policyApp(), [cite('Fire cover')])).toEqual(['Fire cover']);
  });

  it('verifies a citation that names its pack, and refuses one naming a pack that does not exist', async () => {
    expect(await surviving(twoPacks(), [cite('Fire cover', { context: 'policy_brief' }), cite('second', { context: 'policy_document' })])).toEqual([
      'Fire cover',
      'second',
    ]);
    // `second` is a related cell of `policy_document`, which `policy_brief` does not carry.
    expect(await surviving(twoPacks(), [cite('second', { context: 'policy_brief' }), cite('Fire cover', { context: 'nope' })])).toEqual([]);
  });
});

describe('[ADR-0160 D9] a caller with no read access', () => {
  it('gets "not verified" and nothing that tells a hidden record from a missing one', async () => {
    const quote = 'Fire cover';
    const outcomes = await Promise.all([
      verifyRecordCitations([cite(quote)], fakeDoor(policyApp({ unreadableRows: ['p1'] }))),
      verifyRecordCitations([{ object: 'policy', id: 'p404', quote }], fakeDoor(policyApp())),
      verifyRecordCitations([cite(quote)], fakeDoor(policyApp({ unservedObjects: ['policy'] }))),
      verifyRecordCitations([cite(quote)], fakeDoor(policyApp({ guardedObjects: ['policy'] }))),
      verifyRecordCitations([cite(quote)], fakeDoor(policyApp({ unexposedObjects: ['policy'] }))),
    ]);
    for (const outcome of outcomes) expect(outcome).toEqual([]);
  });
});

describe('[ADR-0160 D9] a refusal and a failure', () => {
  /** A door whose root read guard throws `err` instead of answering. */
  const throwingDoor = (err: unknown): FakeDoor => {
    const door = fakeDoor(policyApp());
    door.readGuard = async () => {
      throw err;
    };
    return door;
  };
  const coded = (code: string, status: number) => Object.assign(new Error(code), { code, status });

  /** The surviving quotes and every failure the host was handed. */
  async function run(door: FakeDoor, citations: unknown[]) {
    const reported: Array<{ error: unknown; call: VerifyingCall }> = [];
    const verified = await verifyRecordCitations(citations, door, { onError: (error, call) => reported.push({ error, call }) });
    return { quotes: verified.map((c) => c.quote), reported };
  }

  it('drops the citations of a call that fails without a code and reports the failure, once per call', async () => {
    // Control: the same citations verify through a door that answers.
    expect((await run(fakeDoor(policyApp()), [cite('Fire cover'), cite('Acme')])).quotes).toEqual(['Fire cover', 'Acme']);

    const outage = new Error('connection reset');
    const { quotes, reported } = await run(throwingDoor(outage), [cite('Fire cover'), cite('Acme'), cite('Arson.', { anchor: 'exclusions' })]);
    expect(quotes).toEqual([]);
    expect(reported).toEqual([
      { error: outage, call: { object: 'policy', id: 'p1' } },
      { error: outage, call: { object: 'policy', id: 'p1', anchor: 'exclusions' } },
    ]);
  });

  it('reports a driver code with no status, and a coded 5xx, as failures', async () => {
    for (const err of [Object.assign(new Error('reset'), { code: 'ECONNRESET' }), coded('INTERNAL_ERROR', 500)]) {
      const { quotes, reported } = await run(throwingDoor(err), [cite('Fire cover')]);
      expect(quotes).toEqual([]);
      expect(reported.map((r) => r.error)).toEqual([err]);
    }
  });

  it('drops the citations of a coded 4xx refusal and reports nothing', async () => {
    for (const err of [coded('PERMISSION_DENIED', 403), coded('RECORD_NOT_FOUND', 404), coded('VALIDATION_ERROR', 400)]) {
      expect(await run(throwingDoor(err), [cite('Fire cover')])).toEqual({ quotes: [], reported: [] });
    }
  });

  it('gives the host the same answer for a refused read and a missing record', async () => {
    const refused = await run(fakeDoor(policyApp({ unreadableRows: ['p1'] })), [cite('Fire cover')]);
    const missing = await run(fakeDoor(policyApp()), [{ object: 'policy', id: 'p404', quote: 'Fire cover' }]);
    expect(refused).toEqual({ quotes: [], reported: [] });
    expect(missing).toEqual(refused);
    // Control: the readable record verifies the quote.
    expect((await run(fakeDoor(policyApp()), [cite('Fire cover')])).quotes).toEqual(['Fire cover']);
  });

  it('never throws when the callback throws, and drops the failed call without one', async () => {
    const door = throwingDoor(new Error('down'));
    await expect(
      verifyRecordCitations([cite('Fire cover')], door, {
        onError: () => {
          throw new Error('logger down');
        },
      }),
    ).resolves.toEqual([]);
    await expect(verifyRecordCitations([cite('Fire cover')], throwingDoor(new Error('down')))).resolves.toEqual([]);
  });
});

describe('[ADR-0160 D9] the list', () => {
  it('makes one call per distinct (object, id, context, anchor)', async () => {
    const door = fakeDoor(policyApp());
    const verified = await verifyRecordCitations(
      [cite('Fire cover'), cite('Acme'), cite('second'), cite('Arson.', { anchor: 'exclusions' }), cite('Exclusions', { anchor: 'exclusions' })],
      door,
    );
    expect(verified).toHaveLength(5);
    expect(door.listCalls).toBe(2);
  });

  it('drops an entry that does not parse, keeps order, and never throws', async () => {
    const list = [cite('Fire cover', { field: 'title' }), null, 'Acme', cite(''), cite('second'), cite('Fire cover')];
    expect(await surviving(policyApp(), list)).toEqual(['second', 'Fire cover']);
    expect(await verifyRecordCitations('not a list', fakeDoor(policyApp()))).toEqual([]);
    expect(await verifyRecordCitations(undefined, fakeDoor(policyApp()))).toEqual([]);
  });

  it('reads at most RECORD_CITATIONS_MAX entries of the list', async () => {
    const list = Array.from({ length: RECORD_CITATIONS_MAX + 5 }, (_, i) => cite(i < RECORD_CITATIONS_MAX ? 'Fire cover' : 'Acme'));
    const verified = await verifyRecordCitations(list, fakeDoor(policyApp()));
    expect(verified).toHaveLength(RECORD_CITATIONS_MAX);
    expect(verified.every((c) => c.quote === 'Fire cover')).toBe(true);
  });

  it('returns the citations as parsed, context and anchor included', async () => {
    const c = cite('Arson.', { context: 'policy_document', anchor: 'exclusions' });
    expect(await verifyRecordCitations([c], fakeDoor(policyApp()))).toEqual([c]);
  });
});
