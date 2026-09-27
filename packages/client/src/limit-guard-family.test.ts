import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ObjectStackClient } from './index';

/**
 * The `limit` query-parameter emitters of this SDK, pinned as ONE family (#19567).
 *
 * They used to guard three different ways — a truthy test, `!= null`, and
 * `!== undefined` — so one input got a different answer by method:
 * `{ limit: 0 }` was dropped by some (the server then answered `200` with its
 * DEFAULT window, a page the caller did not ask for) and sent by the others
 * (`400` from a door that declares `min(1)`); `null` was dropped by some and
 * sent by the rest.
 *
 * The rule now is the one the declared doors need: the SDK does not judge
 * `limit`. Only an ABSENT value (`undefined`) stays off the wire; `0`, `NaN`
 * and an untyped `null` all leave the client exactly as written, and the door
 * that declares the bound is the one that refuses. Every emitter is driven
 * through the real method against a stubbed `fetch`, and the assertion reads
 * the URL it actually requested.
 *
 * `null` is outside every emitter's declared type (`limit?: number`); it is
 * driven through a cast because an untyped caller can still pass it. Pinning
 * it as SENT is deliberate: dropping it again would turn the `400` those
 * doors answer today into a silent `200` with a default page.
 */

type Emitter = {
  /** The public path a caller writes. */
  label: string;
  /** Drives the method with `{ limit }` (or its positional equivalent). */
  call: (client: ObjectStackClient, limit: number | undefined) => Promise<unknown>;
};

const ENV = 'env_limit';

const EMITTERS: readonly Emitter[] = [
  { label: 'meta.getHistory', call: (c, limit) => c.meta.getHistory('object', 'task', { limit }) },
  { label: 'meta.getAudit', call: (c, limit) => c.meta.getAudit('object', 'task', { limit }) },
  { label: 'environments.listRevisions', call: (c, limit) => c.environments.listRevisions(ENV, { limit }) },
  { label: 'automation.runs.list', call: (c, limit) => c.automation.runs.list('my_flow', { limit }) },
  { label: 'automation.listRuns', call: (c, limit) => c.automation.listRuns('my_flow', { limit }) },
  { label: 'search', call: (c, limit) => c.search('acme', { limit }) },
  { label: 'notifications.list', call: (c, limit) => c.notifications.list({ limit }) },
  { label: 'ai.conversations.list', call: (c, limit) => c.ai.conversations.list({ limit }) },
  { label: 'ai.pendingActions.list', call: (c, limit) => c.ai.pendingActions.list({ limit }) },
  { label: 'data.listImportJobs', call: (c, limit) => c.data.listImportJobs({ limit }) },
  { label: 'data.export', call: (c, limit) => c.data.export('task', { limit }) },
  { label: 'environment().meta.getHistory', call: (c, limit) => c.environment(ENV).meta.getHistory('object', 'task', { limit }) },
  { label: 'environment().data.listImportJobs', call: (c, limit) => c.environment(ENV).data.listImportJobs({ limit }) },
  { label: 'environment().automation.listRuns', call: (c, limit) => c.environment(ENV).automation.listRuns('my_flow', { limit }) },
];

/** The URL the method requested, after it has run to completion or failed on the stub body. */
async function requestedUrl(emitter: Emitter, limit: number | undefined): Promise<URL> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data: {} }),
    headers: new Headers(),
  });
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
  // Only the request matters here; a method that trips over the stub body
  // AFTER fetching has still told us what it sent.
  await emitter.call(client, limit).then(() => undefined, () => undefined);
  expect(fetchMock, `${emitter.label} never reached fetch`).toHaveBeenCalledTimes(1);
  return new URL(String(fetchMock.mock.calls[0][0]));
}

describe('the limit emitter family sends what the caller wrote', () => {
  it.each(EMITTERS.map((e) => [e.label, e] as const))('%s: an absent limit stays off the wire', async (_label, emitter) => {
    const url = await requestedUrl(emitter, undefined);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it.each(EMITTERS.map((e) => [e.label, e] as const))('%s: an ordinary limit is sent', async (_label, emitter) => {
    const url = await requestedUrl(emitter, 20);
    expect(url.searchParams.getAll('limit')).toEqual(['20']);
  });

  it.each(EMITTERS.map((e) => [e.label, e] as const))('%s: limit 0 is sent, not swapped for the default window', async (_label, emitter) => {
    const url = await requestedUrl(emitter, 0);
    expect(url.searchParams.getAll('limit')).toEqual(['0']);
  });

  it.each(EMITTERS.map((e) => [e.label, e] as const))('%s: limit NaN is sent, not swapped for the default window', async (_label, emitter) => {
    const url = await requestedUrl(emitter, Number.NaN);
    expect(url.searchParams.getAll('limit')).toEqual(['NaN']);
  });

  it.each(EMITTERS.map((e) => [e.label, e] as const))('%s: an untyped null is sent as written, for the door to refuse', async (_label, emitter) => {
    const url = await requestedUrl(emitter, null as unknown as number);
    expect(url.searchParams.getAll('limit')).toEqual(['null']);
  });

  it('drives every limit emitter in index.ts — a new one has to join this table', () => {
    // The census the table above must cover: every `set('limit', …)` call plus
    // the one emitter that spells the key inside a template literal. A new
    // emitter that is not added to EMITTERS changes this count, so it cannot
    // arrive with a fourth guard spelling unpinned.
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const setCalls = source.match(/\.set\('limit',/g) ?? [];
    const templateEmitters = source.match(/\?limit=\$\{/g) ?? [];
    expect(setCalls.length + templateEmitters.length).toBe(EMITTERS.length);
  });
});
