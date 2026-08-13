// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7556] The showcase's `objectExtensions` entry, read back through every
// `/meta` surface that serves an object schema — over real HTTP, on a stack
// booted the way a DEPLOYED runtime boots.
//
// `examples/app-showcase/src/data/extensions/account.extension.ts` contributes
// three fields to `showcase_account` (`loyalty_tier`, `linkedin_url`,
// `csat_score`) and its own docstring states the contract: they "show up on the
// Account form/list exactly as if they were authored inline". They did not.
// They were served by `GET /meta/object`, they round-tripped through the data
// API, and they were ABSENT from `GET /meta/object/showcase_account` and from
// both layers of `?layers=true` — which is the read the edit and new forms
// derive from, so three fields that persist through the API could never be set
// in the UI.
//
// WHY THIS FILE BOOTS ITS OWN STACK, and does not use `getSharedShowcase()`:
// the shared harness boots the stack in-process from the TypeScript config, and
// on that path ObjectQL's `bridgeObjectsToMetadataService` seeds the `metadata`
// service from `registry.getAllObjects()` — bodies that are ALREADY folded. The
// bug is invisible there, and measuring it on that harness reports a green that
// means nothing. A deployment instead ingests a COMPILED ARTIFACT
// (`artifactSource` — `objectstack serve`, sealed runtimes, the cloud), whose
// `objects` and `objectExtensions` are separate collections, so the service's
// copy of the object carries no extender. That is the boot reproduced here, and
// it is the one the defect was measured on.
//
// The unit-level agreement pin for the same defect is
// `packages/rest/src/meta-object-extension-agreement.test.ts`; this file is the
// end-to-end proof that the fold reaches a real showcase over real HTTP.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

/** Contributed by the extension ONLY — `showcase_account` declares none of them. */
const EXTENSION_FIELDS = ['loyalty_tier', 'linkedin_url', 'csat_score'];

function fieldNamesOf(item: unknown): string[] {
  const fields = (item as { fields?: unknown } | null | undefined)?.fields;
  if (!fields) return [];
  const names = Array.isArray(fields)
    ? (fields as Array<{ name?: unknown }>).map((f) => String(f?.name))
    : Object.keys(fields as Record<string, unknown>);
  return [...names].sort();
}

describe('dogfood: an object extension reaches every /meta read (#7556)', () => {
  let stack: VerifyStack;
  let token: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'os-7556-ext-'));
    const artifactPath = join(tempDir, 'objectstack.json');
    // The real `objectstack build` lowering, not `JSON.stringify(stack)` — that
    // drops callables silently and the artifact parses green carrying none of
    // what it advertises (#6293).
    writeBuildShapedArtifact(showcaseStack as unknown as Record<string, unknown>, artifactPath);

    stack = await bootStack(showcaseStack, {
      extraPlugins: [
        new MetadataPlugin({
          rootDir: tempDir,
          watch: false,
          artifactWatch: false,
          registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
      ],
    });
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  const listedFields = async (): Promise<string[]> => {
    const res = await stack.apiAs(token, 'GET', '/meta/object');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const items = (Array.isArray(body)
      ? body
      : ((body as { items?: unknown[]; data?: unknown[] })?.items
        ?? (body as { data?: unknown[] })?.data
        ?? [])) as Array<{ name?: string }>;
    return fieldNamesOf(items.find((o) => o?.name === 'showcase_account'));
  };

  it('the list read composes the extension — the premise every other case is measured against', async () => {
    const listed = await listedFields();
    for (const field of EXTENSION_FIELDS) expect(listed).toContain(field);
  });

  it('the by-name read serves the same fields the list read does', async () => {
    const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_account');
    expect(res.status).toBe(200);
    const body: any = await res.json();

    // Agreement, not presence: pinning "contains loyalty_tier" would pass again
    // the day this one route were special-cased, which is the same defect one
    // layer over. Both sides are measured here, in this test.
    expect(fieldNamesOf(body?.item)).toEqual(await listedFields());
  });

  it('`?layers=true` resolves the object in BOTH layers it reports', async () => {
    const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const listed = await listedFields();

    // The issue's sharpest evidence was that the fields were missing from BOTH
    // layers rather than folded into the wrong one — which is what pointed at
    // layer resolution rather than REST plumbing. `code` is the owner's
    // declaration with its extenders folded on (ADR-0029 D9.6); `effective` is
    // `overlay ?? code`, and the showcase customises nothing, so both must
    // carry the extension and both must equal the list read.
    expect(fieldNamesOf(body?.code)).toEqual(listed);
    expect(fieldNamesOf(body?.effective)).toEqual(listed);
    // No tenant customisation exists, and an extension is not one: the overlay
    // layer stays empty rather than being handed the extension to report.
    expect(body?.overlay ?? null).toBeNull();
  });

  it('an object nothing extends is unchanged — the fold is not applied to every payload', async () => {
    const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_task');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const served = fieldNamesOf(body?.item);

    // `showcase_task` has no `extend` contributor. If correcting three fields on
    // one object had altered the shape of every object's payload, it would show
    // here first.
    expect(served.length).toBeGreaterThan(0);
    for (const field of EXTENSION_FIELDS) expect(served).not.toContain(field);
  });

  it('the fields the forms can now show are the same ones the data API persists', async () => {
    // The half that always worked, kept in the same file as the half that did
    // not: the columns are real, so a form that cannot show them is the whole
    // defect rather than a cosmetic gap.
    const created = await stack.apiAs(token, 'POST', '/data/showcase_account', {
      name: 'ext-meta-read-7556',
      loyalty_tier: 'gold',
      csat_score: 91,
    });
    expect(created.status).toBe(201);
    const createdBody: any = await created.json();
    const id = createdBody?.id;
    expect(id).toBeTruthy();

    const read = await stack.apiAs(token, 'GET', `/data/showcase_account/${id}`);
    expect(read.status).toBe(200);
    const readBody: any = await read.json();
    expect(readBody?.record?.loyalty_tier).toBe('gold');
    expect(readBody?.record?.csat_score).toBe(91);
  });
});
