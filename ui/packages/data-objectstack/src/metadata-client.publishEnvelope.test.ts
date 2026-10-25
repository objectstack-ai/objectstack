/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `publish` and `publishDraft` hit ONE route and must hold ONE belief about
 * its wire shape (objectui#6962).
 *
 * ## What was measured, because this card forbids inferring it
 *
 * The card's own triage refused to act on `PublishMetaItemResponseSchema`
 * alone — "an inference from the declaration, not a measurement of the
 * server". So the producer was read instead, in the framework checkout:
 *
 *  - `POST /api/v1/meta/:type/:name/publish` is mounted in exactly one place,
 *    `packages/rest/src/rest-server.ts`, and that handler ends
 *    `res.json(await p.publishMetaItem(publishRequest))` — the protocol's own
 *    object, verbatim, with no envelope branch on any arm. The ADR-0006
 *    project-scoped base re-mounts the same handler.
 *  - The `{ success, data }` envelope has ONE producer, `HttpDispatcher`
 *    (`runtime/src/http-dispatcher.ts`, `success()` → `{ success, data, meta }`),
 *    and it does not serve this route. `runtime/src/domains/meta.ts` has no
 *    publish branch — its three-segment arm matches `/published` on GET only —
 *    and `runtime/src/route-ledger.ts` carries no row for a publish POST, so a
 *    dispatcher-fronted host answers this path with `routeNotFound`, never with
 *    a payload. That holds for the dispatcher-only Hono adapter
 *    (`adapters/hono`, whose `${prefix}/*` catch-all IS `dispatch()`) as much
 *    as for a full `rest` + `plugin-hono-server` boot, where the REST mount
 *    shadows that catch-all.
 *  - `packages/spec` declares the split explicitly rather than by omission:
 *    `PublishMetaItemResponseSchema` documents "the FULL body" of this route,
 *    while its batch sibling `PublishPackageDraftsResponseSchema` documents a
 *    body answered "inside the dispatcher's `{ success, data }` envelope".
 *
 * ⇒ The route never envelopes, so the tolerance `publishDraft` carried was a
 * dialect with no producer, and Commandment #0.1 says it goes.
 *
 * ## Why these pins use an envelope-shaped INPUT, and why that is the point
 *
 * A pin asserting only "publish returns the body" is worthless here: it passes
 * on a method that returns the body AND on one that would have unwrapped an
 * envelope it never receives. Those two spellings differ on exactly one input,
 * so that input is what gets driven. `expect(result).toEqual(ENVELOPED)` goes
 * RED the moment either method starts unwrapping again — which is the whole
 * caricature this card has to exclude (both unwrap, or the two disagree).
 *
 * ⚠️ Read the assertions as pinning ONE ANSWER FOR TWO METHODS, not as a
 * blessing of the enveloped body. Nothing serves it. If a server ever does,
 * that is a producer defect to file upstream — the answer is not a second
 * unwrapping site here, and the `version` assertion below says why: unwrapping
 * would let a body this door never served read as a successful promotion.
 */

import { describe, it, expect, vi } from 'vitest';
import { PublishMetaItemResponseSchema } from '@objectstack/spec/api';
import { MetadataClient, type MetadataSaveAdvisoryEvent } from './metadata-client';

/** The three keys `PublishMetaItemResponseSchema` states as REQUIRED, plus its receipt. */
const BARE_BODY = {
  success: true,
  version: 'sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  seq: 7,
  message: 'Published draft — type=view, name=cases [seq=7]',
};

/**
 * The discriminating input: the dispatcher-shaped envelope nobody serves on
 * this route. Deliberately carries the SAME payload as {@link BARE_BODY} one
 * level down, so an unwrapping method and a verbatim one return values that
 * differ only in the nesting — which is precisely what the pins read.
 */
const ENVELOPED_BODY = { success: true, data: { ...BARE_BODY } };

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(body: unknown, onSaveAdvisory?: (ev: MetadataSaveAdvisoryEvent) => void) {
  return new MetadataClient({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => response(body)) as unknown as typeof fetch,
    ...(onSaveAdvisory ? { onSaveAdvisory } : {}),
  });
}

/**
 * The premise, asserted against the INSTALLED spec rather than quoted from the
 * card: the declared body carries its keys at the TOP LEVEL and declares no
 * envelope, so `data` is not a member a conformant publish response can have.
 *
 * The reverse probe is what makes it a reading rather than a restatement: the
 * enveloped shape must be REJECTED by the same schema, or "the bare shape
 * parses" would prove only that the schema accepts anything.
 */
describe('the declared publish body (objectstack#7294), read off the installed spec', () => {
  it('declares `success` / `version` / `seq` at the top level, with no envelope', () => {
    const bare = PublishMetaItemResponseSchema.safeParse(BARE_BODY);
    expect(bare.success).toBe(true);
    expect(bare.success && bare.data.version).toBe(BARE_BODY.version);
    // `data` is not a declared member, so an object schema STRIPS it — the
    // discriminating reading is that it does not survive the parse.
    const withData = PublishMetaItemResponseSchema.safeParse({ ...BARE_BODY, data: { seq: 99 } });
    expect(withData.success && Object.prototype.hasOwnProperty.call(withData.data, 'data')).toBe(
      false,
    );
  });

  it('refuses the enveloped shape outright — `version` and `seq` are missing from it', () => {
    const enveloped = PublishMetaItemResponseSchema.safeParse(ENVELOPED_BODY);
    expect(enveloped.success).toBe(false);
  });
});

/**
 * THE CARD. One route, one spelling — driven on the only input that can tell
 * the two spellings apart.
 */
describe('publish and publishDraft answer the same route the same way (#6962)', () => {
  it('publishDraft returns an envelope-shaped body VERBATIM — it no longer unwraps', async () => {
    const result = await clientWith(ENVELOPED_BODY).publishDraft('view', 'cases');

    // The whole assertion: the envelope is still an envelope on the way out.
    expect(result).toEqual(ENVELOPED_BODY);
    // Spelled out, because `toEqual` on a two-key object is easy to misread:
    // the payload stays NESTED and is not hoisted to the top level.
    expect((result as { data?: unknown }).data).toEqual(BARE_BODY);
    expect((result as { version?: unknown }).version).toBeUndefined();
    expect((result as { seq?: unknown }).seq).toBeUndefined();
  });

  it('publish returns the same envelope-shaped body verbatim, as it always did', async () => {
    const result = await clientWith(ENVELOPED_BODY).publish<Record<string, unknown>>('view', 'cases');

    expect(result).toEqual(ENVELOPED_BODY);
    expect(result.version).toBeUndefined();
  });

  it('the two methods return DEEP-EQUAL values for one response — the disagreement is gone', async () => {
    // The card itself: same route, same bytes, two methods. Compared as
    // values rather than asserted twice, so a future edit that changes one
    // method's shape cannot leave the other silently behind.
    const viaPublish = await clientWith(ENVELOPED_BODY).publish('view', 'cases');
    const viaDraft = await clientWith(ENVELOPED_BODY).publishDraft('view', 'cases');
    expect(viaDraft).toEqual(viaPublish);

    const bareViaPublish = await clientWith(BARE_BODY).publish('view', 'cases');
    const bareViaDraft = await clientWith(BARE_BODY).publishDraft('view', 'cases');
    expect(bareViaDraft).toEqual(bareViaPublish);
  });

  /**
   * ⚠️ The `undefined === undefined` trap this card is actually about.
   *
   * `version` reading `undefined` IS the failure mode under investigation, so
   * a pin that merely compared it to `undefined` would prove nothing. Both
   * legs below therefore assert a CONCRETE token, and the enveloped leg above
   * asserts the absence separately — the two together are what separate "the
   * OCC token is readable" from "both sides are blank".
   */
  it('keeps the ADR-0008 `version` / `seq` readable off BOTH methods on a normal response', async () => {
    const viaPublish = await clientWith(BARE_BODY).publish<typeof BARE_BODY>('view', 'cases');
    const viaDraft = await clientWith(BARE_BODY).publishDraft('view', 'cases');

    expect(viaPublish.version).toBe(BARE_BODY.version);
    expect((viaDraft as { version?: string }).version).toBe(BARE_BODY.version);
    expect(viaPublish.seq).toBe(7);
    expect((viaDraft as { seq?: number }).seq).toBe(7);
  });

  it('leaves the unenveloped path — the one every server actually serves — untouched', async () => {
    // The non-regression axis: the plausible WRONG fix over-tightens and
    // breaks the shape existing callers read. `usePublishAllDrafts` reads
    // `seedApplied` off `publishDraft`'s return, so the whole body must
    // survive, not just the three required keys.
    const withSeed = { ...BARE_BODY, seedApplied: { success: false, inserted: 0, updated: 0, error: 'no rows' } };
    const result = await clientWith(withSeed).publishDraft('seed', 'demo_rows');

    expect(result).toEqual(withSeed);
    expect(result.seedApplied).toEqual({ success: false, inserted: 0, updated: 0, error: 'no rows' });
  });
});

/**
 * The advisory channel follows the same object, on both doors — PR #6961's
 * presentation reads whatever each method treats as the response, so it stays
 * correct without a second decision (the scope fence this card adopted).
 */
describe('advisory reporting reads the same object both methods return (#6962)', () => {
  /**
   * FULLY shaped, and that is load-bearing rather than tidy: `readSaveAdvisories`
   * requires all six string keys and silently DROPS a finding missing any of
   * them. A half-shaped fixture would make the "reports NOTHING" case below
   * pass for the wrong reason — an empty sink proving only that the fixture was
   * malformed. Measured: with three keys, the positive control below went red
   * (`expected [] to have a length of 1`) while the absence case stayed green.
   */
  const ADVISORY = {
    severity: 'warning' as const,
    rule: 'flow/delete-without-filter',
    where: 'flow "nightly_purge" · node "purge old rows"',
    path: 'flows[0].nodes[2].config.filters',
    message: 'this delete_record node sets multi: true with no filter',
    hint: 'add a filter, or set multi: false to delete a single record',
  };

  it('reports top-level advisories through both doors', async () => {
    const body = { ...BARE_BODY, advisories: [ADVISORY] };

    const viaPublish: MetadataSaveAdvisoryEvent[] = [];
    await clientWith(body, (e) => viaPublish.push(e)).publish('flow', 'nightly_purge');
    const viaDraft: MetadataSaveAdvisoryEvent[] = [];
    await clientWith(body, (e) => viaDraft.push(e)).publishDraft('flow', 'nightly_purge');

    expect(viaPublish).toHaveLength(1);
    expect(viaDraft).toEqual(viaPublish);
    expect(viaDraft[0]!.advisories).toEqual([ADVISORY]);
  });

  it('reports NOTHING for an enveloped body — through both doors, identically', async () => {
    // The honest consequence of the ruling, pinned rather than left implicit:
    // advisories are declared at the top level, an enveloped body has none
    // there, and neither door goes hunting one level down for them. Pinned as
    // an absence so a "helpful" traversal cannot be re-added silently.
    const enveloped = { success: true, data: { ...BARE_BODY, advisories: [ADVISORY] } };

    const viaPublish: MetadataSaveAdvisoryEvent[] = [];
    await clientWith(enveloped, (e) => viaPublish.push(e)).publish('flow', 'nightly_purge');
    const viaDraft: MetadataSaveAdvisoryEvent[] = [];
    await clientWith(enveloped, (e) => viaDraft.push(e)).publishDraft('flow', 'nightly_purge');

    expect(viaPublish).toEqual([]);
    expect(viaDraft).toEqual([]);
  });
});
