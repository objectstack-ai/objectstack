// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5111 / #5040 E7] THE FLIP — a non-empty `apis:` publishes; each endpoint is gated.
 *
 * ## What this file replaces
 *
 * It was `apis-no-executor.test.ts`, and it pinned the opposite assertion:
 * #4936 refused every non-empty `apis:` because the surface was zero-execution
 * end to end — nothing mounted a declared `path`, no matcher existed, and every
 * key was declared ≠ enforced, `authRequired` included. The #5040 E-series
 * built the executor, so that premise is gone. The refusal narrows to a set of
 * per-endpoint gates, and the first `it` below is the flip's positive
 * assertion: a well-formed endpoint PASSES validation, for the first time since
 * #4936.
 *
 * ## Why the assertions live on the SCHEMA, not on `defineStack`
 *
 * Unchanged from the file this replaces, and the reason is the same:
 * `ObjectStackDefinitionSchema` is the single choke point every publish and
 * validate path runs through — `defineStack` (spec), the metadata plugin's
 * artifact ingestion (`ObjectStackDefinitionSchema.parse`), `os validate`, the
 * lint scorer, and `EnvironmentArtifactSchema.metadata`. A gate placed in one
 * caller would be a gate the other four forget. Both seams are asserted below.
 *
 * ## Read every rejection as a security assertion
 *
 * These endpoints are LIVE once published. A gate that stops working does not
 * fail loudly — it publishes an endpoint the runtime then serves, which is why
 * each gate is pinned by its message content (the prescription the author
 * reads) and not merely by `success: false`.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { ApiEndpointSchema, normalizeEndpointPath } from './endpoint.zod';
import { identityFreeEndpointGateFailure, validateApiEndpointDeclarations } from './endpoint-publish-gate';

const manifest = {
  id: 'com.example.apis',
  name: 'apis-test',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'showcase',
};

/** A fully valid `object_operation` endpoint under the stack's own namespace. */
const validObjectEndpoint = {
  name: 'showcase_task_feed',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET' as const,
  summary: 'Task feed',
  type: 'object_operation' as const,
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' as const },
  authRequired: true,
  cacheTtl: 30,
};

/** A fully valid `flow` endpoint under the same namespace. */
const validFlowEndpoint = {
  name: 'showcase_inquiry_purge_api',
  path: '/api/v1/apps/showcase/inquiries/purge',
  method: 'POST' as const,
  type: 'flow' as const,
  target: 'showcase_inquiry_purge',
  authRequired: true,
};

/** Parse through the real seam and return the issue messages, joined. */
function reject(stack: Record<string, unknown>): string {
  const result = ObjectStackDefinitionSchema.safeParse(stack);
  expect(result.success, 'the declaration must NOT parse clean').toBe(false);
  return result.success ? '' : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
}

/** Parse a stack that must be accepted; returns the parsed endpoints. */
function accept(stack: Record<string, unknown>) {
  const result = ObjectStackDefinitionSchema.safeParse(stack);
  expect(
    result.success ? '' : JSON.stringify(result.error.issues),
    'the declaration must parse clean',
  ).toBe('');
  return result.success ? result.data.apis : undefined;
}

describe('[#5111] the flip — a well-formed `apis:` publishes', () => {
  it('accepts an object_operation endpoint under the stack\'s own namespace', () => {
    const apis = accept({ manifest, apis: [validObjectEndpoint] });
    expect(apis).toHaveLength(1);
    // Anti-vacuity: the endpoint is not merely tolerated, it survives parsing
    // whole — including the schema default that makes omission SAFE.
    expect(apis?.[0]?.authRequired).toBe(true);
    expect(apis?.[0]?.objectParams).toEqual({ object: 'showcase_task', operation: 'find' });
  });

  it('accepts a flow endpoint alongside it, through `defineStack` too', () => {
    expect(() => defineStack({ manifest, apis: [validObjectEndpoint, validFlowEndpoint] })).not.toThrow();
  });

  // [#10338] The acceptance half of the ruling that made `target` optional:
  // an `object_operation` endpoint is addressed by `objectParams.object` /
  // `.operation`, and NO consumer reads `target` for that type (executor,
  // OpenAPI enrichment and this gate all branch on `objectParams` alone) — so
  // the author-facing contract stops demanding a dead string. Restoring
  // required-ness in the vocabulary turns exactly this case red.
  it('accepts an object_operation endpoint that omits `target` — nothing consumes it for that type', () => {
    const { target: _dead, ...objectEndpointWithoutTarget } = validObjectEndpoint;
    const apis = accept({ manifest, apis: [objectEndpointWithoutTarget] });
    expect(apis).toHaveLength(1);
    // Anti-vacuity: the endpoint parses whole, addressed by objectParams.
    expect(apis?.[0]?.objectParams).toEqual({ object: 'showcase_task', operation: 'find' });
    expect(apis?.[0]?.target).toBeUndefined();
  });

  it('accepts an anonymous endpoint that arms its rate limit (ADR-0121 D6 satisfied)', () => {
    const apis = accept({
      manifest,
      apis: [
        {
          ...validFlowEndpoint,
          name: 'showcase_partner_webhook',
          path: '/api/v1/apps/showcase/hooks/partner',
          authRequired: false,
          rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100 },
        },
      ],
    });
    expect(apis?.[0]?.authRequired).toBe(false);
    expect(apis?.[0]?.rateLimit?.enabled).toBe(true);
  });

  it('accepts mapping keys on a body-carrying operation', () => {
    accept({
      manifest,
      apis: [
        {
          ...validObjectEndpoint,
          name: 'showcase_task_create',
          path: '/api/v1/apps/showcase/tasks',
          method: 'POST',
          objectParams: { object: 'showcase_task', operation: 'create' },
          cacheTtl: undefined,
          inputMapping: [{ source: 'title', target: 'name' }, { source: 'meta.owner', target: 'owner_id' }],
          outputMapping: [{ source: 'id', target: 'task_id' }],
        },
      ],
    });
  });

  it('still accepts an EMPTY and an ABSENT `apis:` — the #4936 regression pin', () => {
    expect(ObjectStackDefinitionSchema.safeParse({ manifest, apis: [] }).success).toBe(true);
    expect(ObjectStackDefinitionSchema.safeParse({ manifest }).success).toBe(true);
    expect(() => defineStack({ manifest, apis: [] })).not.toThrow();
    expect(() => defineStack({ manifest })).not.toThrow();
    // A stack with NO namespace and no endpoints must stay publishable: the
    // namespace requirement is triggered by declaring `apis:`, never by
    // existing.
    const { namespace: _dropped, ...noNamespace } = manifest;
    expect(ObjectStackDefinitionSchema.safeParse({ manifest: noNamespace, apis: [] }).success).toBe(true);
  });
});

describe('[#5111] gate (c) — namespace carve-out (ADR-0121 D1/D2)', () => {
  it('rejects a path outside the `apps/<namespace>/` mount, naming the endpoint and the shape', () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, path: '/api/v1/showcase/tasks' }],
    });
    expect(message).toMatch(/showcase_task_feed/);
    expect(message).toMatch(/apis\.0\.path/);
    expect(message).toMatch(/\/api\/v1\/apps\/showcase\//);
  });

  it("rejects a path under ANOTHER package's namespace", () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, path: '/api/v1/apps/crm/tasks' }],
    });
    expect(message).toMatch(/not inside this stack's endpoint carve-out/);
  });

  it('rejects the mount with an empty subpath — the namespace root is not claimable', () => {
    for (const path of ['/api/v1/apps/showcase', '/api/v1/apps/showcase/', '/api/v1/apps/showcase//']) {
      const message = reject({ manifest, apis: [{ ...validObjectEndpoint, path }] });
      expect(message, path).toMatch(/non-empty subpath/);
    }
  });

  it('rejects a path that merely LOOKS like the mount (`/apps/showcasex/…`)', () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, path: '/api/v1/apps/showcasex/tasks' }],
    });
    expect(message).toMatch(/carve-out/);
  });

  it('rejects `apis:` on a stack with no explicit `manifest.namespace` (Q1 = A, no derivation)', () => {
    const { namespace: _dropped, ...noNamespace } = manifest;
    const message = reject({ manifest: noNamespace, apis: [validObjectEndpoint] });
    expect(message).toMatch(/MUST declare an explicit `manifest.namespace`/);
    // The ruling is that the fallback does NOT apply: `com.example.apis` would
    // derive `apis` under `deriveNamespaceFromPackageId`, and the rejection
    // must not hint that it did.
    expect(message).toMatch(/NOT derived from/);
    // Reported ONCE, against `apis` — not once per endpoint.
    const result = ObjectStackDefinitionSchema.safeParse({
      manifest: noNamespace,
      apis: [validObjectEndpoint, validFlowEndpoint],
    });
    const custom = result.success ? [] : result.error.issues.filter((i) => i.code === 'custom');
    expect(custom).toHaveLength(1);
  });
});

describe('[#5310] the `path` vocabulary text is itself publishable', () => {
  /**
   * `ApiEndpointSchema.path`'s `.describe()` is not a code comment. Since `api`
   * became a registered metadata kind (#5271) it is the field help the
   * metadata-admin endpoint form renders, and it lands in the generated JSON
   * Schema — so it is the first-hand prompt an author copies, and the author is
   * very often an AI maintainer (ADR-0033) that copies it verbatim. It used to
   * read `URL Path (e.g. /api/v1/customers)`, an example `namespaceGate` rejects
   * on sight (ADR-0121 D1): the vocabulary's own example was the one shape
   * publish refuses.
   *
   * The assertion reads the text back OUT of the schema instead of restating
   * it, so it cannot drift from the string an author actually sees — put a
   * rejected path back into the `.describe()` and this file goes red.
   */
  const description = ApiEndpointSchema.shape.path.description ?? '';

  /** Concrete paths in that text. `<manifest.namespace>` is a placeholder, not an example. */
  const concreteExamples = (description.match(/\/[A-Za-z0-9_<>./-]+/g) ?? []).filter(
    (candidate) => !candidate.includes('<'),
  );

  it('shows the author at least one CONCRETE example path', () => {
    expect(description, '`path` must carry a description — it is the form\'s field help').not.toBe('');
    expect(
      concreteExamples,
      `no concrete example path found in: ${description}`,
    ).not.toHaveLength(0);
  });

  it('every concrete example it shows PASSES the gate that judges authored paths', () => {
    for (const path of concreteExamples) {
      const carveOut = /^\/api\/v1\/apps\/([a-z][a-z0-9_]{1,19})\/(.+)$/.exec(path);
      expect(
        carveOut,
        `example '${path}' is not \`/api/v1/apps/[namespace]/[subpath]\` — the shape ADR-0121 D1 requires`,
      ).not.toBeNull();

      // Judged under the namespace the example itself names: the carve-out is
      // derived from `manifest.namespace` (D2), so an example is only honest
      // paired with the manifest that could declare it.
      const namespace = carveOut![1]!;
      const issues = validateApiEndpointDeclarations(
        [ApiEndpointSchema.parse({ ...validObjectEndpoint, path })],
        { namespace },
      );
      expect(
        issues.map((issue) => issue.message).join('\n'),
        `example '${path}' must publish under \`manifest.namespace: '${namespace}'\``,
      ).toBe('');
    }
  });

  it('the example it USED to show is still rejected — the defect itself, pinned', () => {
    const message = reject({ manifest, apis: [{ ...validObjectEndpoint, path: '/api/v1/customers' }] });
    expect(message).toMatch(/not inside this stack's endpoint carve-out/);
  });
});

describe('[#5111] gate (a) — the supported subset (mirrors `planEndpointTarget`)', () => {
  it("rejects `type: 'script'` with the flow prescription", () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, type: 'script', target: 'do_thing', objectParams: undefined }],
    });
    expect(message).toMatch(/does not execute/);
    expect(message).toMatch(/type: 'flow'/);
  });

  it("rejects `type: 'proxy'` and says why (outbound/SSRF ruling pending)", () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, type: 'proxy', target: 'https://example.com', objectParams: undefined }],
    });
    expect(message).toMatch(/SSRF|egress/);
  });

  it('rejects an object_operation missing `objectParams.object`', () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, objectParams: { operation: 'find' } }],
    });
    expect(message).toMatch(/objectParams\.object` is missing/);
  });

  it('rejects an object_operation missing `objectParams.operation`', () => {
    const message = reject({
      manifest,
      apis: [{ ...validObjectEndpoint, objectParams: { object: 'showcase_task' } }],
    });
    expect(message).toMatch(/objectParams\.operation` is missing/);
  });

  it('rejects a flow endpoint with an empty `target`', () => {
    const message = reject({ manifest, apis: [{ ...validFlowEndpoint, target: '' }] });
    expect(message).toMatch(/names no target flow/);
  });

  // [#10338] `target` is optional in the VOCABULARY (an `object_operation`
  // author no longer writes a dead string), so omission now reaches this gate
  // instead of dying as a Zod `invalid_type` — and the gate is what holds the
  // requirement for `type: 'flow'`. The issue path is asserted too: the author
  // must be sent to the `target` line, not to the endpoint at large.
  it('rejects a flow endpoint that omits `target` entirely — the gate holds the requirement now', () => {
    const { target: _dead, ...flowWithoutTarget } = validFlowEndpoint;
    const message = reject({ manifest, apis: [flowWithoutTarget] });
    expect(message).toMatch(/apis\.0\.target: .*names no target flow/);
  });
});

describe('[#5111] gate (b) — mapping declarations (mirrors `mappingDeclarationRejection`)', () => {
  const bodyEndpoint = {
    ...validObjectEndpoint,
    name: 'showcase_task_create',
    method: 'POST' as const,
    objectParams: { object: 'showcase_task', operation: 'create' as const },
    cacheTtl: undefined,
  };

  it('rejects `transform` on either mapping key', () => {
    for (const key of ['inputMapping', 'outputMapping'] as const) {
      const message = reject({
        manifest,
        apis: [{ ...bodyEndpoint, [key]: [{ source: 'a', target: 'b', transform: 'upper' }] }],
      });
      expect(message, key).toMatch(/transformation-function registry/);
      expect(message, key).toMatch(new RegExp(`apis\\.0\\.${key}\\.0\\.transform`));
    }
  });

  it('rejects unusable `source` / `target` paths — empty, empty segment, prototype keys', () => {
    const unusable = ['', 'a..b', '.a', 'a.', '__proto__', 'a.prototype.b', 'constructor'];
    for (const bad of unusable) {
      expect(
        reject({ manifest, apis: [{ ...bodyEndpoint, inputMapping: [{ source: bad, target: 'ok' }] }] }),
        `source '${bad}'`,
      ).toMatch(/not a usable field path/);
      expect(
        reject({ manifest, apis: [{ ...bodyEndpoint, inputMapping: [{ source: 'ok', target: bad }] }] }),
        `target '${bad}'`,
      ).toMatch(/not a usable field path/);
    }
  });

  it('rejects colliding targets — the same path, and one inside another', () => {
    const same = reject({
      manifest,
      apis: [{ ...bodyEndpoint, outputMapping: [{ source: 'a', target: 'x' }, { source: 'b', target: 'x' }] }],
    });
    expect(same).toMatch(/collides with outputMapping\[0\]\.target 'x'/);

    const nested = reject({
      manifest,
      apis: [{ ...bodyEndpoint, outputMapping: [{ source: 'a', target: 'x' }, { source: 'b', target: 'x.y' }] }],
    });
    expect(nested).toMatch(/silently discard/);
  });

  it('rejects `inputMapping` on find / get / delete — declared but provably inert (PM ruling)', () => {
    for (const operation of ['find', 'get', 'delete'] as const) {
      const message = reject({
        manifest,
        apis: [
          {
            ...validObjectEndpoint,
            method: operation === 'delete' ? 'DELETE' : 'GET',
            cacheTtl: undefined,
            objectParams: { object: 'showcase_task', operation },
            inputMapping: [{ source: 'a', target: 'b' }],
          },
        ],
      });
      expect(message, operation).toMatch(/never reads a request body/);
      expect(message, operation).toMatch(/create` \/ `update/);
    }
  });

  it('does NOT reject `outputMapping` on those operations — a find still has a result to project', () => {
    accept({
      manifest,
      apis: [{ ...validObjectEndpoint, outputMapping: [{ source: 'records', target: 'items' }] }],
    });
  });
});

describe('[#5111] gate (e) — policy keys (ADR-0121 D6 + the E4 refusals)', () => {
  it('rejects `authRequired: false` with NO rateLimit', () => {
    const message = reject({ manifest, apis: [{ ...validFlowEndpoint, authRequired: false }] });
    expect(message).toMatch(/ADR-0121 D6|armed rate limit/i);
    expect(message).toMatch(/No `rateLimit` is declared at all/);
  });

  it('rejects `authRequired: false` with an UNARMED rateLimit — the `enabled` default trap', () => {
    // `RateLimitConfigSchema.enabled` defaults to FALSE, so this declaration
    // satisfies "carries a rateLimit" while metering nothing. A presence check
    // would publish an anonymous, unmetered endpoint.
    const message = reject({
      manifest,
      apis: [{ ...validFlowEndpoint, authRequired: false, rateLimit: { windowMs: 60_000, maxRequests: 100 } }],
    });
    expect(message).toMatch(/DEFAULTS to `false`/);
    expect(message).toMatch(/enabled: true/);
  });

  it('rejects `authRequired: false` with an explicitly disabled rateLimit', () => {
    const message = reject({
      manifest,
      apis: [
        { ...validFlowEndpoint, authRequired: false, rateLimit: { enabled: false, maxRequests: 5 } },
      ],
    });
    expect(message).toMatch(/anonymous AND unmetered/);
  });

  it('rejects an armed budget that cannot be honoured (maxRequests / windowMs <= 0)', () => {
    const zeroBudget = reject({
      manifest,
      apis: [{ ...validFlowEndpoint, rateLimit: { enabled: true, maxRequests: 0 } }],
    });
    expect(zeroBudget).toMatch(/rejects every request/);
    expect(zeroBudget).toMatch(/apis\.0\.rateLimit\.maxRequests/);

    const badWindow = reject({
      manifest,
      apis: [{ ...validFlowEndpoint, rateLimit: { enabled: true, windowMs: -1 } }],
    });
    expect(badWindow).toMatch(/MILLISECONDS/);
  });

  it('accepts an armed budget with defaults materialized (`enabled: true` alone)', () => {
    const apis = accept({ manifest, apis: [{ ...validFlowEndpoint, rateLimit: { enabled: true } }] });
    expect(apis?.[0]?.rateLimit).toEqual({ enabled: true, windowMs: 60_000, maxRequests: 100 });
  });

  it('rejects a negative `cacheTtl`, and accepts 0 (an explicit no-store)', () => {
    const message = reject({ manifest, apis: [{ ...validObjectEndpoint, cacheTtl: -5 }] });
    expect(message).toMatch(/cannot be negative/);
    accept({ manifest, apis: [{ ...validObjectEndpoint, cacheTtl: 0 }] });
  });

  it('rejects `cacheTtl` on a non-GET endpoint', () => {
    const message = reject({
      manifest,
      apis: [{ ...validFlowEndpoint, cacheTtl: 30 }],
    });
    expect(message).toMatch(/GET-only/);
    expect(message).toMatch(/apis\.0\.cacheTtl/);
  });
});

describe('[#5111] gate (d) — one claim per METHOD + path inside a stack', () => {
  it('rejects two endpoints claiming the same method and path, naming BOTH', () => {
    const message = reject({
      manifest,
      apis: [validObjectEndpoint, { ...validObjectEndpoint, name: 'showcase_task_feed_copy' }],
    });
    expect(message).toMatch(/showcase_task_feed_copy/);
    expect(message).toMatch(/already claimed by endpoint 'showcase_task_feed' \(apis\[0\]\)/);
  });

  it('applies the matcher\'s normalization — one trailing slash is not a different route', () => {
    const message = reject({
      manifest,
      apis: [
        validObjectEndpoint,
        { ...validObjectEndpoint, name: 'showcase_task_feed_slash', path: '/api/v1/apps/showcase/tasks/' },
      ],
    });
    expect(message).toMatch(/same claim/);
    // The rule the gate applies is the exported one the matcher indexes with,
    // not a second copy: if this ever diverges the gate publishes duplicates
    // the matcher silently resolves to one winner.
    expect(normalizeEndpointPath('/api/v1/apps/showcase/tasks/')).toBe('/api/v1/apps/showcase/tasks');
    expect(normalizeEndpointPath('/')).toBe('/');
    expect(normalizeEndpointPath('/x//')).toBe('/x/');
  });

  it('allows the same path under different methods', () => {
    accept({
      manifest,
      apis: [
        validObjectEndpoint,
        {
          ...validObjectEndpoint,
          name: 'showcase_task_create',
          method: 'POST',
          cacheTtl: undefined,
          objectParams: { object: 'showcase_task', operation: 'create' },
        },
      ],
    });
  });
});

describe('[#5111] every rejection is actionable, and reaches every publish seam', () => {
  it('reports one issue per offending endpoint — three bad endpoints, three rejections', () => {
    const result = ObjectStackDefinitionSchema.safeParse({
      manifest,
      apis: [
        { ...validObjectEndpoint, name: 'a_bad', path: '/api/v1/nope' },
        { ...validFlowEndpoint, name: 'b_bad', target: '' },
        { ...validObjectEndpoint, name: 'c_bad', path: '/api/v1/apps/showcase/other', cacheTtl: -1 },
      ],
    });
    const custom = result.success ? [] : result.error.issues.filter((i) => i.code === 'custom');
    expect(custom).toHaveLength(3);
    expect(custom.map((i) => i.path.join('.'))).toEqual(['apis.0.path', 'apis.1.target', 'apis.2.cacheTtl']);
  });

  it('`defineStack` throws the same prescription an artifact parse reports', () => {
    expect(() => defineStack({ manifest, apis: [{ ...validObjectEndpoint, type: 'proxy', objectParams: undefined }] }))
      .toThrow(/does not execute/);
  });

  it('no rejection message tells the author to delete `apis:` any more', () => {
    // The #4936 prescription ("delete the `apis:` entries") is retired with the
    // blanket refusal. A gate that still said it would send an author to
    // remove a capability that now works.
    const message = reject({ manifest, apis: [{ ...validObjectEndpoint, path: '/api/v1/nope' }] });
    expect(message).not.toMatch(/delete the `apis:` entries/i);
    expect(message).not.toMatch(/DECLARED BUT NOT EXECUTABLE/);
  });
});

describe('[#5111] the `ApiEndpoint` vocabulary itself is untouched', () => {
  // Anti-vacuity for the whole file: the flip is validation logic on the
  // EXISTING keys. If a key had been added, removed or renamed, every
  // assertion above could still pass while the frozen-vocabulary constraint
  // (#5040) had been violated.
  it('still parses a full endpoint on its own, every key intact', () => {
    const parsed = ApiEndpointSchema.parse(validObjectEndpoint);
    expect(parsed.name).toBe('showcase_task_feed');
    expect(parsed.path).toBe('/api/v1/apps/showcase/tasks');
    expect(parsed.method).toBe('GET');
    expect(parsed.type).toBe('object_operation');
    expect(parsed.objectParams).toEqual({ object: 'showcase_task', operation: 'find' });
    expect(parsed.authRequired).toBe(true);
    expect(parsed.cacheTtl).toBe(30);
  });

  it('keeps `authRequired` defaulting to true — omission is the SAFE state', () => {
    const parsed = ApiEndpointSchema.parse({
      name: 'x_endpoint',
      path: '/api/v1/apps/showcase/x',
      method: 'GET',
      type: 'flow',
      target: 'x_flow',
    });
    expect(parsed.authRequired).toBe(true);
  });

  it('keeps endpoint-level `rateLimit` in the vocabulary (#4910-Q2 routed it here)', () => {
    const parsed = ApiEndpointSchema.parse({
      name: 'x_endpoint',
      path: '/api/v1/apps/showcase/x',
      method: 'GET',
      type: 'flow',
      target: 'x_flow',
      rateLimit: { enabled: true },
    });
    expect(parsed.rateLimit).toBeDefined();
  });

  it('still rejects a malformed endpoint on its own terms', () => {
    // Guards the guard: the vocabulary must still be a real schema, not an
    // `any` that would make the assertions above meaningless.
    expect(() => ApiEndpointSchema.parse({ name: 'Bad Name', path: 'no-slash' })).toThrow();
  });
});

// ============================================================================
// [#5189 / #5040 E7b] The identity-free subset, for consumers holding one
// stored endpoint and no stack.
// ============================================================================

describe('identityFreeEndpointGateFailure — the same judge, minus stack identity', () => {
  it('passes an endpoint that passes the full gates', () => {
    expect(identityFreeEndpointGateFailure(ApiEndpointSchema.parse(validObjectEndpoint))).toBeUndefined();
  });

  it('still refuses D6 — the gate with no runtime counterpart, and the reason #5189 exists', () => {
    const failure = identityFreeEndpointGateFailure(
      ApiEndpointSchema.parse({ ...validObjectEndpoint, cacheTtl: undefined, authRequired: false }),
    );
    expect(failure).toBeDefined();
    expect(failure!.path).toEqual(['rateLimit']);
    expect(failure!.message).toContain('authRequired: false');
    expect(failure!.message).toContain('enabled: true');
  });

  it('accepts an anonymous endpoint whose budget is ARMED', () => {
    expect(
      identityFreeEndpointGateFailure(
        ApiEndpointSchema.parse({
          ...validObjectEndpoint,
          cacheTtl: undefined,
          authRequired: false,
          rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 },
        }),
      ),
    ).toBeUndefined();
  });

  it('still refuses the target, mapping and policy gates', () => {
    const cases: Array<[Record<string, unknown>, (string | number)[]]> = [
      [{ type: 'proxy', target: 'https://x.test', objectParams: undefined }, ['type']],
      [{ objectParams: { object: 'showcase_task' } }, ['objectParams']],
      [{ outputMapping: [{ source: 'a', target: 'b', transform: 'upper' }] }, ['outputMapping', 0, 'transform']],
      [{ cacheTtl: -1 }, ['cacheTtl']],
    ];
    for (const [over, path] of cases) {
      const failure = identityFreeEndpointGateFailure(
        ApiEndpointSchema.parse({ ...validObjectEndpoint, ...over }),
      );
      expect(failure).toBeDefined();
      // Paths are relative to the ENDPOINT, not to a stack's `apis:` array.
      expect(failure!.path).toEqual(path);
    }
  });

  it('does NOT judge the namespace — that gate needs a manifest this caller does not have', () => {
    // The full gate rejects this path under `namespace: 'showcase'`; the
    // identity-free subset cannot, and must not pretend to.
    const stray = ApiEndpointSchema.parse({ ...validObjectEndpoint, path: '/api/v1/elsewhere' });
    expect(identityFreeEndpointGateFailure(stray)).toBeUndefined();
    expect(validateApiEndpointDeclarations([stray], { namespace: 'showcase' })).toHaveLength(1);
  });

  it('does NOT judge uniqueness — a single endpoint has no siblings to collide with', () => {
    const one = ApiEndpointSchema.parse(validObjectEndpoint);
    expect(identityFreeEndpointGateFailure(one)).toBeUndefined();
    expect(identityFreeEndpointGateFailure(one)).toBeUndefined();
    // …while the full gate still catches the pair.
    expect(validateApiEndpointDeclarations([one, one], { namespace: 'showcase' })).toHaveLength(1);
  });
});
