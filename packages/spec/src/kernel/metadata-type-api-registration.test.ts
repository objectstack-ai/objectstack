// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `api` IS a declared metadata kind (#5271, part of #5206).
 *
 * ## What was wrong, in one sentence
 *
 * `api` items were produced (artifact ingest maps `defineStack({ apis })` →
 * `api`), indexed (`buildEndpointIndex`) and executed (#5040 E5/E8) while the
 * spec declared the kind NOWHERE — so `getMetadataTypeSchema('api')` returned
 * `undefined` and `saveMetaItem` took its documented "unregistered type ⇒ store
 * without validation" branch. `PUT /api/v1/meta/api/:name` accepted any JSON at
 * all. That is `declared ≠ enforced` read backwards: ENFORCED BUT UNDECLARED.
 *
 * ## The two doors this file keeps apart
 *
 * These tests pin the registration and the SHAPE door only. Whether a
 * well-shaped endpoint is SERVABLE — the ADR-0121 D1/D2 carve-out, D6's
 * anonymous-needs-an-armed-budget rule, the supported target subset, the
 * mapping and policy rules — belongs to
 * `validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure`
 * (`../api/endpoint-publish-gate`), which run at publish and again at load.
 * The last test here pins that separation directly, because a registry entry
 * that grew a second opinion about servability is the one way this change
 * could go wrong later.
 *
 * ## …and WHICH channel the shape door stands in (updated by #5488)
 *
 * `api` is now CODE-ONLY (`allowRuntimeCreate: false` + `allowOrgOverride:
 * false`, maintainer ruling 2026-08-07T16:59Z). The declaration schema is
 * therefore consulted on the ARTIFACT route — stack compile, `publishPackage`,
 * loader ingest — and no longer on `PUT /api/v1/meta/api/:name`, which the
 * #5086 inlet refuses with 403 `NOT_CREATABLE` before any body validation
 * runs. The schema cases below are unchanged and still correct: they assert
 * `ApiEndpointSchema` itself, which is the same object either route reaches.
 * Only the door it stands in moved. See the retirement pins below for why.
 */

import { describe, it, expect } from 'vitest';

import { ApiEndpointSchema } from '../api/endpoint.zod';
import { identityFreeEndpointGateFailure } from '../api/endpoint-publish-gate';
import { DEFAULT_METADATA_TYPE_REGISTRY, MetadataTypeSchema } from './metadata-plugin.zod';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from './metadata-type-schemas';

/** The E8-migrated showcase shape, transcribed from
 *  `examples/app-showcase/src/system/apis/index.ts`. The originals are typed
 *  `ApiEndpoint` at their own site and boot-proven by
 *  `packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`;
 *  this copy exists so the spec package can assert the binding without
 *  depending on an example. */
const SHOWCASE_TASK_FEED = {
  name: 'showcase_task_feed',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  summary: 'Task feed',
  description: 'Returns tasks via a declarative object_operation endpoint — no handler code.',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
  authRequired: true,
  cacheTtl: 30,
} as const;

/** The flow-typed half of the same stack. */
const SHOWCASE_INQUIRY_PURGE = {
  name: 'showcase_inquiry_purge_api',
  path: '/api/v1/apps/showcase/inquiries/purge',
  method: 'POST',
  summary: 'Purge closed inquiries',
  type: 'flow',
  target: 'showcase_inquiry_purge',
  authRequired: true,
} as const;

const apiEntry = () => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'api');

describe('`api` is a declared metadata kind', () => {
  it('is a member of MetadataTypeSchema', () => {
    expect(MetadataTypeSchema.safeParse('api').success).toBe(true);
  });

  it('has an entry in DEFAULT_METADATA_TYPE_REGISTRY', () => {
    expect(apiEntry(), '`api` missing from DEFAULT_METADATA_TYPE_REGISTRY').toBeDefined();
    expect(apiEntry()!.domain).toBe('system');
    expect(apiEntry()!.label).toBe('API Endpoint');
  });

  it('is enumerable by getMetaTypes(): the registry entry carries file patterns and a schema', () => {
    // `getMetaTypes()` (metadata-protocol) decorates each registry entry with
    // `getMetadataTypeSchema(type)`. Before #5271 `api` could only appear as a
    // SYNTHESISED descriptor — `label: 'api'`, `filePatterns: []`,
    // `domain: 'system'`, `schema: undefined` — so the metadata-admin engine
    // had no JSON Schema to build a form from and fell back to a raw-JSON
    // textarea. Both halves of that fix are asserted together because either
    // one alone leaves the form unrenderable.
    expect(apiEntry()!.filePatterns.length).toBeGreaterThan(0);
    expect(getMetadataTypeSchema('api')).toBeDefined();
  });

  it('resolves to ApiEndpointSchema — the one endpoint shape (#4939 convergence)', () => {
    // Identity, not "some schema": `packages/spec/src/api` deliberately retired
    // its rival endpoint shapes down to this one, and a binding to a lookalike
    // would silently reintroduce the second dialect that retirement removed.
    expect(getMetadataTypeSchema('api')).toBe(ApiEndpointSchema);
    expect(listMetadataTypeSchemaTypes()).toContain('api');
  });
});

describe('`api` registry flags — the authorization verdict, written down', () => {
  // ── RETIREMENT PINS (#5488) ───────────────────────────────────────────────
  //
  // These two cases REPLACE the #5271 tripwire pins that asserted the opposite
  // (`allowRuntimeCreate: true`, "is NOT code-only"). Those pins were doing
  // their job: their comments predicted, verbatim, that flipping this flag
  // would make the type code-only under #5086 and leave PR #5279's
  // `publishPackageDrafts` endpoint gate with no draft it could ever gate.
  // Both predictions were correct, and both outcomes are now INTENDED —
  // maintainer ruling 2026-08-07T16:59Z (Option B), implemented by #5488.
  //
  // What the tripwires could not see is why: the runtime create door they were
  // protecting opened onto nothing. `matchEndpoint` → `EndpointMatcher` →
  // `MetadataManager.listForIndex('api')` reads the manager's registry plus the
  // filesystem/memory loaders; a runtime write lands in `sys_metadata`, which
  // is in neither, so a runtime-created endpoint 404s forever (real boot,
  // #5488). ADR-0049 calls a declared-but-unhonoured capability false
  // compliance and requires enforce-or-remove; this is the remove side.
  //
  // Re-entry path, as the ruling recorded it: if #2657 Part B promotes `apis`
  // to a registered type WITH A REAL CONSUMPTION PATH, flip back then —
  // implementation first, declaration second. Until then these pins are what
  // makes a silent re-flip loud.

  it('declares `allowRuntimeCreate: false` — the runtime create door is retired (#5488)', () => {
    expect(apiEntry()!.allowRuntimeCreate).toBe(false);
  });

  it('IS code-only: no runtime write channel is declared (#5086 refuses the inlet)', () => {
    // The exact predicate #5086 (PR #5263) refuses on, spelled as the gate
    // spells it. `true` here is what makes `PUT /api/v1/meta/api/:name` answer
    // 403 `NOT_CREATABLE` instead of 200 "Saved" — in draft mode too, since the
    // inlet runs before the draft/publish branch and does not look at `mode`.
    const entry = apiEntry()!;
    const codeOnly = entry.allowRuntimeCreate === false && entry.allowOrgOverride === false;
    expect(codeOnly).toBe(true);
  });

  it('keeps `filePatterns` non-empty, so the 403 can prescribe the artifact route', () => {
    // `codeOnlySourceHint` reads `filePatterns[0]` straight back into the
    // refusal body ("Declare it in source (…) and redeploy"). An empty array
    // would refuse the write and then say nothing about the route that DOES
    // serve endpoints — the stack artifact compiled through `publishPackage`.
    // Same reason `capability` pins this (ADR-0066 D1 / #5961).
    expect(apiEntry()!.filePatterns[0]).toMatch(/\.api\./);
  });

  it('declares `allowOrgOverride: false` — an endpoint is the publisher’s outward URL', () => {
    // A per-org fork could move `path`, flip `authRequired` or drop
    // `rateLimit` on a URL third parties have already integrated against.
    // ADR-0005 defaults the flag to false so opting in is deliberate.
    expect(apiEntry()!.allowOrgOverride).toBe(false);
  });

  it('declares `executionPinned: false` — the pinned artifact is the target flow', () => {
    // ADR-0009 pins metadata whose runtime invocations can pause across
    // redeploys. An endpoint DELEGATES (ADR-0121 D5); `flow` carries the pin.
    expect(apiEntry()!.executionPinned).toBe(false);
    const flow = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'flow');
    expect(flow!.executionPinned).toBe(true);
  });

  it('loads after `flow`, so a flow-typed endpoint’s target already exists', () => {
    const flow = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'flow');
    expect(apiEntry()!.loadOrder).toBeGreaterThan(flow!.loadOrder);
  });
});

describe('the declaration shape door (artifact / publish route — see the header note)', () => {
  it('accepts the E8-migrated showcase endpoints (object_operation + flow)', () => {
    // A VALUE verdict — the rule judges the body, not whether a key is an
    // authoring surface — so the criterion is a fully green `safeParse`, not
    // merely "no unrecognized keys".
    for (const endpoint of [SHOWCASE_TASK_FEED, SHOWCASE_INQUIRY_PURGE]) {
      const parsed = ApiEndpointSchema.safeParse(endpoint);
      expect(
        parsed.success,
        parsed.success ? '' : `${endpoint.name}: ${JSON.stringify(parsed.error?.issues)}`,
      ).toBe(true);
    }
  });

  it('refuses a body missing `target` — loudly, naming the key', () => {
    // The shape `PUT /meta/api/:name` used to store with a 200: no execution
    // target at all, so nothing could ever run it.
    const parsed = ApiEndpointSchema.safeParse({
      name: 'headless_endpoint',
      path: '/api/v1/apps/showcase/x',
      method: 'GET',
      type: 'object_operation',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join('.'))).toContain('target');
  });

  it('refuses a body that is not an endpoint at all', () => {
    const parsed = ApiEndpointSchema.safeParse({ hello: 'world' });
    expect(parsed.success).toBe(false);
  });

  it('refuses a `path` with no leading slash', () => {
    const parsed = ApiEndpointSchema.safeParse({ ...SHOWCASE_TASK_FEED, path: 'apps/showcase/tasks' });
    expect(parsed.success).toBe(false);
  });
});

describe('the shape door does NOT duplicate the endpoint publish gate', () => {
  it('a schema-valid but UNSERVABLE endpoint passes here and is refused by the gate', () => {
    // ADR-0121 D6: anonymous access requires an ARMED rate limit. The schema
    // has no opinion about that pairing — and must not grow one, or there
    // would be two judges of what is servable and they would drift. This is
    // the assertion that fails if somebody later "helpfully" folds a gate rule
    // into `ApiEndpointSchema`.
    const anonymousUnmetered = {
      ...SHOWCASE_TASK_FEED,
      name: 'anon_unmetered',
      authRequired: false,
    };

    const parsed = ApiEndpointSchema.safeParse(anonymousUnmetered);
    expect(parsed.success, 'the SHAPE is fine — only servability is not').toBe(true);

    const failure = identityFreeEndpointGateFailure(parsed.data!);
    expect(failure, 'ADR-0121 D6 must still refuse it at the gate').toBeDefined();
    expect(failure!.path).toEqual(['rateLimit']);
  });
});
