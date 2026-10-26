/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The PUBLISH door must surface the runtime authoring gate's advisory findings
 * (objectui#5026; contract objectstack#9176).
 *
 * ## Why this door is the one that matters
 *
 * objectui#4133 / PR #4236 wired the advisory rendering to the SAVE door and
 * scoped this one out, because `PublishMetaItemResponseSchema` carried no
 * `advisories` key at the time. It does now. That deferral left the common path
 * silent, and for a precise reason both halves of which are pinned here:
 *
 * - Studio's designer stages every edit as a `mode: 'draft'` save, and drafts
 *   are NEVER gated — the framework returns at its D1 early-return before a
 *   rule runs, so the save door has nothing to report on that flow.
 * - The promotion that follows IS gated. It is the write the gate actually
 *   grades, and until this change objectui parsed its response and dropped the
 *   findings on the floor exactly one layer further out than the server used to.
 *
 * So on the flow most tenants actually use, the author was told nothing at
 * either door. These pins are the red-first evidence: with the emit removed
 * from `publish()` / `publishDraft()`, every "emits" case below fails because no
 * event ever arrives.
 *
 * ## The BATCH door reports too, and this file pins both halves (objectui#6965)
 *
 * This section used to say that `POST /packages/:id/publish-drafts` ("publish
 * whole app") still discarded per-draft advisories SERVER-side, and the last
 * case in this file pinned that absence: a batch-shaped body reaching this
 * client rendered nothing. That sentence was the absence pin's whole reason,
 * and objectstack#9343 falsified it — the batch response now carries
 * `advisories` on EACH `published[]` element, declared by
 * `PublishPackageDraftsResponseSchema` in the INSTALLED `@objectstack/spec`.
 *
 * So the absence is flipped to a presence, at the door that owns the route:
 * {@link MetadataClient.publishPackageDrafts} emits one event per advised
 * element. What the flip must NOT lose is what the absence was really
 * protecting — that the client renders only what the server sent, where the
 * server's own schema declares it. Both halves are pinned below:
 *
 * - The batch door renders findings that arrived on a body the spec accepts,
 *   and renders NOTHING it had to invent — a half-shaped finding, an element
 *   that cannot name its item, a top-level `advisories` the ruled shape does
 *   not put there.
 * - The single-item door still does not dig into `published[]`. Its own
 *   response schema declares no such key, and "look wherever a finding might
 *   be" is the contract-inventing move the original pin was built to block.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PublishMetaItemResponseSchema,
  PublishPackageDraftsResponseSchema,
} from '@objectstack/spec/api';
import {
  MetadataClient,
  type MetadataSaveAdvisoryEvent,
  type RuntimeAuthoringIssue,
} from './metadata-client';

/** The measured `nightly_purge` finding, in the spec's D3 shape. */
const PURGE_ADVISORY: RuntimeAuthoringIssue = {
  severity: 'warning',
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

/** A second finding, so a per-element assertion cannot pass by coincidence. */
const CASES_ADVISORY: RuntimeAuthoringIssue = {
  severity: 'warning',
  rule: 'view/column-references-missing-field',
  where: 'view "cases" · column 3',
  path: 'columns[2].field',
  message: 'this column binds `owner_name`, which the object does not declare',
  hint: 'bind an existing field, or add `owner_name` to the object',
};

/** The three keys `PublishMetaItemResponseSchema` states as REQUIRED. */
const CLEAN_BODY = {
  success: true,
  version: 'sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  seq: 7,
  message: 'Published draft — type=flow, name=nightly_purge [seq=7]',
};

/** An ADR-0008 content hash, in the format the batch door returns per element. */
const VERSION = 'sha256:1a2b3c4d5e6f70819293a4b5c6d7e8f91a2b3c4d5e6f70819293a4b5c6d7e8f9';

/**
 * A "publish whole app" body with findings on ONE of two promoted elements —
 * the six keys `PublishPackageDraftsResponseSchema` states as REQUIRED, plus
 * the optional `advisories` where the ruling puts them.
 *
 * Built as a function so a case can vary one element without the others
 * drifting, and asserted against the installed schema below rather than
 * trusted: a fixture nothing validates is how a client ends up pinning its own
 * imagination.
 */
function batchBody(
  published: Array<Record<string, unknown>> = [
    { type: 'view', name: 'cases', version: VERSION },
    { type: 'flow', name: 'nightly_purge', version: VERSION, advisories: [PURGE_ADVISORY] },
  ],
) {
  return {
    success: true,
    outcome: 'published',
    publishedCount: published.length,
    failedCount: 0,
    published,
    failed: [],
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(
  responseBody: unknown,
  onSaveAdvisory?: (ev: MetadataSaveAdvisoryEvent) => void,
) {
  return new MetadataClient({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => response(responseBody)) as unknown as typeof fetch,
    ...(onSaveAdvisory ? { onSaveAdvisory } : {}),
  });
}

/**
 * The premise, asserted rather than assumed — and asserted against the
 * INSTALLED `@objectstack/spec`, not against the upstream PR's description of
 * it. This card was held 13 days on a spec-pin condition and released on a
 * version-ordering argument; the reading that actually opened the gate is this
 * one, so it lives in CI instead of in a transcript.
 *
 * The reverse probe is what makes the positive a measurement: a half-shaped
 * finding must be REJECTED, or "the key parses" would prove only that the
 * schema ignores it.
 */
describe('the contract this renders (objectstack#9176), read off the installed spec', () => {
  it('declares `advisories` on the publish response, and validates its elements', () => {
    const withAdvisories = PublishMetaItemResponseSchema.safeParse({
      ...CLEAN_BODY,
      advisories: [PURGE_ADVISORY],
    });
    expect(withAdvisories.success).toBe(true);
    // Declared, not merely tolerated: an undeclared key is STRIPPED by the
    // object schema, so surviving the parse is the discriminating reading.
    expect(
      withAdvisories.success &&
        Object.prototype.hasOwnProperty.call(withAdvisories.data, 'advisories'),
    ).toBe(true);

    const halfShaped = PublishMetaItemResponseSchema.safeParse({
      ...CLEAN_BODY,
      advisories: [{ rule: 'flow/delete-without-filter' }],
    });
    expect(halfShaped.success).toBe(false);
  });

  it('omits the key entirely on a clean publish — absence means "nothing to report"', () => {
    const clean = PublishMetaItemResponseSchema.safeParse(CLEAN_BODY);
    expect(clean.success).toBe(true);
    expect(clean.success && Object.prototype.hasOwnProperty.call(clean.data, 'advisories')).toBe(
      false,
    );
  });
});

/**
 * The batch door's premise, asserted against the INSTALLED spec for the same
 * reason its single-item sibling above is: this half of objectui#6965 was held
 * on objectstack#9343 landing, and what releases it is not that card's state
 * but the shape a consumer can actually install and read.
 *
 * ⭐ The third case is the one that keeps the client honest. The ruling was
 * explicit that advisories ride EACH element and that there is NO parallel
 * top-level map; a schema that merely tolerated a top-level key would make
 * "read the elements" a style preference instead of the contract.
 */
describe('the batch contract this renders (objectstack#9343), read off the installed spec', () => {
  it('declares `advisories` on each `published[]` element, and validates its elements', () => {
    const parsed = PublishPackageDraftsResponseSchema.safeParse(batchBody());
    expect(parsed.success).toBe(true);
    const advised = parsed.success
      ? (parsed.data.published[1] as Record<string, unknown>)
      : undefined;
    expect(advised && Object.prototype.hasOwnProperty.call(advised, 'advisories')).toBe(true);

    // The reverse probe: without it, "the key parses" would prove only that
    // the schema ignores what is under it.
    const halfShaped = PublishPackageDraftsResponseSchema.safeParse(
      batchBody([
        { type: 'flow', name: 'nightly_purge', version: VERSION, advisories: [{ rule: 'only-a-rule' }] },
      ]),
    );
    expect(halfShaped.success).toBe(false);
  });

  it('omits the key on a clean element — absence means "nothing to report"', () => {
    const parsed = PublishPackageDraftsResponseSchema.safeParse(batchBody());
    const clean = parsed.success ? (parsed.data.published[0] as Record<string, unknown>) : undefined;
    expect(clean && Object.prototype.hasOwnProperty.call(clean, 'advisories')).toBe(false);
  });

  it('declares NO parallel top-level `advisories` — the ruled shape, not a preference', () => {
    const parsed = PublishPackageDraftsResponseSchema.safeParse({
      ...batchBody(),
      advisories: [PURGE_ADVISORY],
    });
    // Undeclared keys are stripped, so a surviving key would mean the schema
    // declares one. It does not — which is why the client reads the elements.
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.prototype.hasOwnProperty.call(parsed.data, 'advisories')).toBe(
      false,
    );
  });
});

describe('MetadataClient.publish — runtime authoring gate advisories (#5026)', () => {
  it('emits the findings a successful promotion returned', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }, (e) =>
      events.push(e),
    );

    await client.publish('flow', 'nightly_purge');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'flow',
      name: 'nightly_purge',
      door: 'publish',
      mode: 'publish',
      advisories: [PURGE_ADVISORY],
    });
  });

  it('names the PUBLISH door, which `mode` alone cannot say', async () => {
    // A direct active save and a draft promotion both land the body in the
    // active overlay, so both report `mode: 'publish'`. Only `door` separates
    // them, and the renderer needs that separation: "Saved" after a Publish
    // tells the author their change is still a draft.
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }, (e) =>
      events.push(e),
    );

    await client.publish('view', 'cases');

    expect(events[0]!.door).toBe('publish');
    expect(events[0]!.mode).toBe('publish');
  });

  it('carries rule, message and hint through verbatim — they are server prose', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }, (e) =>
      events.push(e),
    );

    await client.publish('flow', 'nightly_purge');

    const [finding] = events[0]!.advisories;
    expect(finding!.rule).toBe('flow/delete-without-filter');
    expect(finding!.message).toBe(PURGE_ADVISORY.message);
    expect(finding!.hint).toBe(PURGE_ADVISORY.hint);
    // Never `error` on this channel — an error-severity finding refuses the
    // promotion and arrives as the 422 `invalid_metadata` envelope instead.
    expect(finding!.severity).toBe('warning');
  });

  it('says nothing on a clean publish — the server omits the key entirely', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(CLEAN_BODY, (e) => events.push(e));

    await client.publish('object', 'account');

    expect(events).toEqual([]);
  });

  it('says nothing when the array is present but empty', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, advisories: [] }, (e) => events.push(e));

    await client.publish('object', 'account');

    expect(events).toEqual([]);
  });

  it('drops half-shaped findings rather than rendering blanks at the author', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      { ...CLEAN_BODY, advisories: [PURGE_ADVISORY, { rule: 'only-a-rule' }, null] },
      (e) => events.push(e),
    );

    await client.publish('flow', 'nightly_purge');

    expect(events[0]!.advisories).toEqual([PURGE_ADVISORY]);
  });

  it('still returns the publish response unchanged', async () => {
    const body = { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] };
    const client = clientWith(body, () => {});

    const result = await client.publish('flow', 'nightly_purge');

    expect(result).toEqual(body);
  });

  it('a throwing sink never fails a promotion the server already committed', async () => {
    const client = clientWith({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }, () => {
      throw new Error('renderer exploded');
    });

    await expect(client.publish('flow', 'nightly_purge')).resolves.toBeTruthy();
  });

  it('survives the withEnvironment clone — console clients are all env-scoped', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const base = new MetadataClient({
      baseUrl: 'http://test.local',
      fetch: vi.fn(async () =>
        response({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }),
      ) as unknown as typeof fetch,
      onSaveAdvisory: (e) => events.push(e),
    });

    await base.withEnvironment('env_1').publish('flow', 'nightly_purge');

    expect(events).toHaveLength(1);
  });

  it('survives the withPreviewDrafts clone', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const base = new MetadataClient({
      baseUrl: 'http://test.local',
      fetch: vi.fn(async () =>
        response({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }),
      ) as unknown as typeof fetch,
      onSaveAdvisory: (e) => events.push(e),
    });

    await base.withPreviewDrafts(true).publish('flow', 'nightly_purge');

    expect(events).toHaveLength(1);
  });
});

describe('MetadataClient.publishDraft — the same door, so the same report', () => {
  it('emits the findings a by-reference promotion returned', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }, (e) =>
      events.push(e),
    );

    await client.publishDraft('flow', 'nightly_purge');

    expect(events).toHaveLength(1);
    expect(events[0]!.door).toBe('publish');
    expect(events[0]!.advisories).toEqual([PURGE_ADVISORY]);
  });

  /**
   * REPLACED, not merely re-spelled (objectui#6962). This case used to pin the
   * `{ success, data }` unwrapping this method carried and `publish()` did
   * not, and it kept passing for the wrong reason: what it proved was that a
   * dialect stayed consistent with itself, on a body no server on this route
   * emits. The route was measured at the producer — one REST mount answering
   * `res.json(protocol.publishMetaItem(...))` verbatim, and no dispatcher
   * branch, ledger row or spec declaration putting an envelope on it — so the
   * unwrapping is gone and both doors read the top level.
   *
   * What replaces it asserts the same thing the old case was reaching for —
   * "the report does not depend on which shape answered" — in the direction
   * that is now true: an enveloped body reports NOTHING, identically at both
   * doors. The full shape-agreement pins live in
   * `metadata-client.publishEnvelope.test.ts`.
   */
  it('reports nothing for an enveloped body, and returns it verbatim', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      { success: true, data: { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] } },
      (e) => events.push(e),
    );

    const result = await client.publishDraft('flow', 'nightly_purge');

    // `advisories` is declared at the TOP LEVEL of `PublishMetaItemResponse`;
    // an enveloped body has none there, and nothing digs for one.
    expect(events).toEqual([]);
    // The body comes back untouched — no hoisting, so a caller can still see
    // it is not the shape this door declares.
    expect(result).toEqual({ success: true, data: { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] } });
    expect((result as { seq?: number }).seq).toBeUndefined();
  });

  it('says nothing on a clean by-reference publish', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(CLEAN_BODY, (e) => events.push(e));

    await client.publishDraft('object', 'account');

    expect(events).toEqual([]);
  });

  /**
   * The door control — what the flipped pin below must NOT take with it.
   *
   * "Publish whole app" is `POST /packages/:id/publish-drafts`, and since
   * objectui#6965 this client expresses it: {@link
   * MetadataClient.publishPackageDrafts}, pinned in the next describe. That
   * says nothing about THIS method, which answers a different route whose
   * response schema declares no `published[]` at all.
   *
   * So if a batch-shaped body ever arrives here, nothing may go hunting
   * through it for findings to render. Reading the place one's own contract
   * declares is what separates rendering from inventing, and a traversal added
   * "helpfully" to the single-item door turns this red.
   */
  it('does NOT dig into a batch-shaped `published[]` body — wrong door, undeclared key', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(batchBody(), (e) => events.push(e));

    await client.publishDraft('flow', 'nightly_purge');

    expect(events).toEqual([]);
  });
});

/**
 * THE FLIPPED PIN (objectui#6965) — same fixture, same question, inverted
 * answer, now asked of the door that owns the route.
 *
 * It was an ABSENCE pin: "a batch-shaped body reaching this client renders
 * nothing", and its stated reason was that `POST /packages/:id/publish-drafts`
 * discarded per-draft advisories server-side. objectstack#9343 landed and
 * retired that reason. Deleting the pin would have dropped the guarantee it
 * was carrying alongside the absence — that the client renders only findings
 * the server actually sent — so it is flipped rather than removed, and the
 * cases below assert BOTH directions:
 *
 *  - present, when the server sent them where the spec declares them;
 *  - absent, for everything the client would have had to invent.
 *
 * ⭐ Red-then-green, because one green proves nothing about a pin that was
 * already passing: the old assertion (`expect(events).toEqual([])`) was run
 * against this new door first and FAILS — the flip is a real behaviour change,
 * not a rewording. That reading is quoted in the pull request.
 */
describe('MetadataClient.publishPackageDrafts — the BATCH door reports (objectui#6965)', () => {
  it('renders the advisories the server sent on a `published[]` element', async () => {
    const body = batchBody();
    // The fixture is the contract, not a guess: it parses against the spec the
    // consumer has installed, so this pin cannot outlive the shape it claims.
    expect(PublishPackageDraftsResponseSchema.safeParse(body).success).toBe(true);
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(body, (e) => events.push(e));

    await client.publishPackageDrafts('crm');

    expect(events).toHaveLength(1);
    expect(events[0]!.advisories).toEqual([PURGE_ADVISORY]);
  });

  it('names the item each finding is about — one event per advised element', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      batchBody([
        { type: 'view', name: 'cases', version: VERSION, advisories: [CASES_ADVISORY] },
        { type: 'object', name: 'account', version: VERSION },
        { type: 'flow', name: 'nightly_purge', version: VERSION, advisories: [PURGE_ADVISORY] },
      ]),
      (e) => events.push(e),
    );

    await client.publishPackageDrafts('crm');

    // The author has to go fix a specific item, so the identity travels with
    // the finding — and the clean element in the middle emits nothing.
    expect(events.map((e) => `${e.type}/${e.name}`)).toEqual(['view/cases', 'flow/nightly_purge']);
    expect(events[0]!.advisories).toEqual([CASES_ADVISORY]);
    expect(events[1]!.advisories).toEqual([PURGE_ADVISORY]);
  });

  it('reports the PUBLISH door, so the frame reads "Published" and not "Saved"', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(batchBody(), (e) => events.push(e));

    await client.publishPackageDrafts('crm');

    // Reused rather than extended to a third value: every item this event
    // names really was published, and the renderer's only door-dependent
    // output is that verb.
    expect(events[0]!.door).toBe('publish');
    expect(events[0]!.mode).toBe('publish');
  });

  it('reads the elements through the dispatcher envelope this route declares', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ success: true, data: batchBody() }, (e) => events.push(e));

    const result = await client.publishPackageDrafts('crm');

    // `PublishPackageDraftsResponseSchema` describes the body "inside the
    // dispatcher's `{ success, data }` envelope" — so the declared object is
    // the inner one, and both the findings and the returned value come from
    // there. The single-item door's refusal to unwrap is the same rule read on
    // its own route, not a disagreement.
    expect(events).toHaveLength(1);
    expect(result.publishedCount).toBe(2);
  });

  it('says nothing about a batch whose elements carry no findings', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      batchBody([{ type: 'view', name: 'cases', version: VERSION }]),
      (e) => events.push(e),
    );

    const result = await client.publishPackageDrafts('crm');

    // The zero is a reading only beside a control that must hit: the call went
    // through and answered, so the silence is about the absent key.
    expect(result.outcome).toBe('published');
    expect(events).toEqual([]);
  });

  it('INVENTS NOTHING: a half-shaped finding on an element is dropped, not rendered', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      batchBody([
        {
          type: 'flow',
          name: 'nightly_purge',
          version: VERSION,
          advisories: [PURGE_ADVISORY, { rule: 'only-a-rule' }, null],
        },
      ]),
      (e) => events.push(e),
    );

    await client.publishPackageDrafts('crm');

    // Half a finding would print blanks at the author, and completing one from
    // the client side would be this client inventing server prose.
    expect(events[0]!.advisories).toEqual([PURGE_ADVISORY]);
  });

  it('INVENTS NOTHING: an element that cannot name its item reports nothing', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      batchBody([{ version: VERSION, advisories: [PURGE_ADVISORY] }]),
      (e) => events.push(e),
    );

    await client.publishPackageDrafts('crm');

    // `type` and `name` are REQUIRED on the element. An event has to name the
    // item the author must go fix; one that cannot is worse than silence, and
    // filling the gap with the package id or a placeholder would be a name the
    // server never sent.
    expect(events).toEqual([]);
  });

  it('INVENTS NOTHING: a top-level `advisories` is not the ruled shape and is not read', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      { ...batchBody([{ type: 'view', name: 'cases', version: VERSION }]), advisories: [PURGE_ADVISORY] },
      (e) => events.push(e),
    );

    await client.publishPackageDrafts('crm');

    // The ruling was "riding each element rather than a parallel top-level
    // map", and the schema declares no such key (pinned above). Reading one
    // anyway would render a finding out of a shape the server does not emit.
    expect(events).toEqual([]);
  });

  it('a throwing sink never fails a batch the server already committed', async () => {
    const client = clientWith(batchBody(), () => {
      throw new Error('renderer exploded');
    });

    await expect(client.publishPackageDrafts('crm')).resolves.toBeTruthy();
  });

  it('refuses an empty packageId instead of firing a malformed request', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => response(batchBody()));
    const client = new MetadataClient({
      baseUrl: 'http://test.local',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await expect(client.publishPackageDrafts('')).rejects.toThrow(/packageId must be non-empty/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to the package route, unscoped by environment, like the call sites it replaces', async () => {
    // Typed like `fetch` so `fetchSpy.mock.calls[0]` is `[url, init]` rather
    // than an empty tuple (the zero-arg impl would otherwise infer `[]`, and
    // indexing it is a compile error) — the spelling `exportDownload.test.ts`
    // already uses, for the same reason it states there. `_url: string` rather
    // than `RequestInfo | URL` because this client builds its URL as a string
    // and the assertion below is meant to keep checking that.
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => response(batchBody()));
    const client = new MetadataClient({
      baseUrl: 'http://test.local',
      environmentId: 'env_1',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await client.publishPackageDrafts('app.k9qk');

    // The environment segment this client puts on `/meta` is deliberately NOT
    // carried here: an `/environments/:id/packages` mirror is a route nothing
    // in this repo has shown exists, and scoping to it would trade a working
    // call for a 404.
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://test.local/api/v1/packages/app.k9qk/publish-drafts');
  });
});
