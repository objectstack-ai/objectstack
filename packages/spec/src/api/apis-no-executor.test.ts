// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4936] A non-empty `apis:` is REJECTED; the `ApiEndpoint` vocabulary is KEPT.
 *
 * ## What this pins, and why it is a rejection rather than a retirement
 *
 * The declarative `apis:` surface was zero-execution end to end. Metadata
 * loading worked perfectly — `GET /api/v1/meta/api` returned the showcase's two
 * endpoints with every key intact — while the execution side never fired once:
 * no route was mounted for a declared `path` (so the request died at Hono's
 * `notFound`, not even reaching the dispatcher), and the dispatcher branch that
 * would have run it called a `matchEndpoint` method that NO implementation in
 * the repo provided. Every key on `ApiEndpointSchema` was therefore
 * declared ≠ enforced, `authRequired: true` included — a security semantic that
 * parsed green and gated nothing.
 *
 * The maintainer verdict (2026-08-04) chose the third route: keep the
 * vocabulary, refuse the authoring. Endpoint shapes are an industry-stable
 * form, so retiring `ApiEndpointSchema` would only mean re-introducing the same
 * schema later; refusing loudly kills the lie just as dead while preserving the
 * vocabulary and the metadata investment. The executor (#5040) replaces this
 * rejection with real execution, and every definition stays valid across that
 * change.
 *
 * ## Why the assertions below live on the SCHEMA, not on `defineStack`
 *
 * `ObjectStackDefinitionSchema` is the single choke point every publish and
 * validate path runs through — `defineStack` (spec), the metadata plugin's
 * artifact ingestion (`ObjectStackDefinitionSchema.parse`), `os validate`, the
 * lint scorer, and `EnvironmentArtifactSchema.metadata`. Putting the refusal
 * there rather than in one caller is what makes it impossible to reach the
 * runtime through a path that forgot to check (Prime Directive #12: reject at
 * authoring/publish, never tolerate in a consumer).
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { ApiEndpointSchema } from './endpoint.zod';

const manifest = {
  id: 'com.example.apis',
  name: 'apis-test',
  version: '1.0.0',
  type: 'app' as const,
};

/** The endpoint the showcase used to ship — a realistic, fully valid one. */
const validEndpoint = {
  name: 'showcase_task_feed',
  path: '/api/v1/showcase/tasks',
  method: 'GET' as const,
  summary: 'Task feed',
  type: 'object_operation' as const,
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' as const },
  authRequired: true,
  cacheTtl: 30,
};

describe('[#4936] non-empty `apis:` is rejected at publish/validate', () => {
  it('rejects a non-empty `apis:` through the schema — the shared publish/validate seam', () => {
    const result = ObjectStackDefinitionSchema.safeParse({ manifest, apis: [validEndpoint] });
    expect(result.success, 'a declared endpoint must NOT parse clean').toBe(false);
  });

  it('rejects it through `defineStack` too — the build path an author actually calls', () => {
    expect(() => defineStack({ manifest, apis: [validEndpoint] })).toThrow(/apis:/);
  });

  it('the rejection carries the prescription, not a bare "too big"', () => {
    const result = ObjectStackDefinitionSchema.safeParse({ manifest, apis: [validEndpoint] });
    expect(result.success).toBe(false);
    const message = result.success ? '' : JSON.stringify(result.error.issues);

    // The fact: declared, but nothing executes it.
    expect(message).toMatch(/DECLARED BUT NOT EXECUTABLE/);
    // The fix the author must apply.
    expect(message).toMatch(/delete the `apis:` entries/i);
    // The honest alternative that works today.
    expect(message).toMatch(/contributes\.routes|http\.server/);
    // The LIVE tracking pointer. #4936 closes with this change, so the
    // prescription must name #5040 — the executor card that is still open —
    // or it sends an upgrading author to a closed issue.
    expect(message).toMatch(/issues\/5040/);
    // And it must promise the vocabulary survives, so nobody "migrates away"
    // from endpoint definitions that are about to start working.
    expect(message).toMatch(/vocabulary is deliberately KEPT/);
  });

  it('points at exactly ONE issue URL, and it is the OPEN one', () => {
    // #4936 closes with this change, so it may appear only as the decision's
    // provenance ("(#4936)"), never as a link an upgrading author is invited to
    // follow for status. #5040 — the executor card — is the live tracker, and
    // it must be the only URL in the string. This is the assertion the test
    // above cannot make: "contains 5040" stays true even if a stale
    // `issues/4936` link were sitting next to it.
    const result = ObjectStackDefinitionSchema.safeParse({ manifest, apis: [validEndpoint] });
    const message = result.success ? '' : JSON.stringify(result.error.issues);
    const urls = [...message.matchAll(/issues\/(\d+)/g)].map((m) => m[1]);
    expect(urls.length, 'the prescription must carry a tracking link').toBeGreaterThan(0);
    expect([...new Set(urls)]).toEqual(['5040']);
  });

  it('accepts an EMPTY `apis:` — the key stays declared and parseable', () => {
    expect(ObjectStackDefinitionSchema.safeParse({ manifest, apis: [] }).success).toBe(true);
    expect(() => defineStack({ manifest, apis: [] })).not.toThrow();
  });

  it('accepts an ABSENT `apis:`', () => {
    expect(ObjectStackDefinitionSchema.safeParse({ manifest }).success).toBe(true);
    expect(() => defineStack({ manifest })).not.toThrow();
  });

  it('rejects on COUNT, not on content — a second valid endpoint is refused the same way', () => {
    const second = {
      name: 'showcase_inquiry_purge_api',
      path: '/api/v1/showcase/inquiries/purge',
      method: 'POST' as const,
      type: 'flow' as const,
      target: 'showcase_inquiry_purge',
      authRequired: true,
    };
    expect(ObjectStackDefinitionSchema.safeParse({ manifest, apis: [second] }).success).toBe(false);
    expect(
      ObjectStackDefinitionSchema.safeParse({ manifest, apis: [validEndpoint, second] }).success,
    ).toBe(false);
  });
});

describe('[#4936] the `ApiEndpoint` vocabulary itself is untouched', () => {
  // Anti-vacuity for the whole file: if the schema had been retired instead of
  // the authoring refused, every assertion above would still pass while the
  // verdict ("词表零折腾" — zero churn to the vocabulary) had been violated.
  it('still parses a full endpoint on its own, every key intact', () => {
    const parsed = ApiEndpointSchema.parse(validEndpoint);
    expect(parsed.name).toBe('showcase_task_feed');
    expect(parsed.path).toBe('/api/v1/showcase/tasks');
    expect(parsed.method).toBe('GET');
    expect(parsed.type).toBe('object_operation');
    expect(parsed.objectParams).toEqual({ object: 'showcase_task', operation: 'find' });
    expect(parsed.authRequired).toBe(true);
    expect(parsed.cacheTtl).toBe(30);
  });

  it('keeps `authRequired` defaulting to true — the key #4936 called out by name', () => {
    const parsed = ApiEndpointSchema.parse({
      name: 'x_endpoint',
      path: '/api/v1/x',
      method: 'GET',
      type: 'flow',
      target: 'x_flow',
    });
    expect(parsed.authRequired).toBe(true);
  });

  it('keeps endpoint-level `rateLimit` in the vocabulary (#4910-Q2 routed it here)', () => {
    const parsed = ApiEndpointSchema.parse({
      name: 'x_endpoint',
      path: '/api/v1/x',
      method: 'GET',
      type: 'flow',
      target: 'x_flow',
      rateLimit: { requests: 10, window: 60 },
    });
    expect(parsed.rateLimit).toBeDefined();
  });

  it('still rejects a malformed endpoint on its own terms', () => {
    // Guards the guard: the vocabulary must still be a real schema, not an
    // `any` that would make the assertions above meaningless.
    expect(() => ApiEndpointSchema.parse({ name: 'Bad Name', path: 'no-slash' })).toThrow();
  });
});
