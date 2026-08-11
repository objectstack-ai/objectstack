// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The two `/meta` routes #7526 found DEAD, exercised end-to-end over real HTTP
// for the answers they are documented to give.
//
// The parity gate next door proves they are MOUNTED and reachable. That is a
// different question from whether they answer anything, and both halves have to
// hold: `GET /meta/:type/:name/published` was reachable in the sense that a
// request to it got a 200 — from the compound-name route, with a body identical
// before publish AND for a name that does not exist. A route that cannot 404 is
// the failure this file pins against.
//
//   * GET /meta/:type/:name/published — ADR-0033 published snapshot.
//     404 for a name nothing declares. 200 with the current definition for one
//     that exists but was never published (getPublished's documented fallback).
//   * GET /meta/objects/:name/state/:field — ADR-0020 D3.3 legal next states.
//     `next: null` when no state_machine governs the field or no `?from=` was
//     given, `next: [...]` for a declared transition, `[]` for a dead end.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

describe('dogfood: /meta/:type/:name/published and /meta/objects/:name/state/:field (#7526)', () => {
  let stack: VerifyStack;
  let token: string;
  let tempDir: string;

  beforeAll(async () => {
    // `getPublished` is a `metadata`-SERVICE capability, and the lean harness
    // boot registers no such service — the route then answers a typed 501,
    // which is the honest degradation but not the behaviour under test.
    // `objectstack serve` composes a MetadataPlugin for every deployment
    // (serve.ts), so booting one here is what a real server looks like, not a
    // fixture convenience.
    tempDir = mkdtempSync(join(tmpdir(), 'os-7526-published-'));
    const artifactPath = join(tempDir, 'objectstack.json');
    // The real `objectstack build` lowering, not `JSON.stringify(stack)` —
    // that drops callables silently and the artifact parses green carrying
    // none of what it advertises (#6293).
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

  describe('GET /meta/:type/:name/published', () => {
    it('404s for a name nothing declares — the answer the old fall-through could never give', async () => {
      const res = await stack.apiAs(token, 'GET', '/meta/object/zzz_not_a_real_object/published');
      expect(res.status).toBe(404);
    });

    it('answers a declared object with its definition rather than the compound-name stub', async () => {
      const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_task/published');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      // The pre-fix answer came from `GET /meta/:type/:section/:name` with
      // `section='showcase_task', name='published'` — a protection envelope for
      // an item called `showcase_task/published`, which is why it was identical
      // for a bogus name. A real published read carries the object itself.
      expect(JSON.stringify(body)).toContain('showcase_task');
    });

    it('does not answer a bogus and a real name identically (the defect, stated directly)', async () => {
      const [bogus, real] = await Promise.all([
        stack.apiAs(token, 'GET', '/meta/object/zzz_not_a_real_object/published'),
        stack.apiAs(token, 'GET', '/meta/object/showcase_task/published'),
      ]);
      expect(bogus.status).not.toBe(real.status);
    });
  });

  describe('GET /meta/objects/:name/state/:field', () => {
    it('returns the legal next states declared by the field\'s state_machine', async () => {
      // showcase_task declares `todo → [in_progress, backlog]`.
      const res = await stack.apiAs(token, 'GET', '/meta/objects/showcase_task/state/status?from=todo');
      expect(res.status).toBe(200);
      const body = await res.json() as { object: string; field: string; from: string | null; next: string[] | null };
      expect(body.object).toBe('showcase_task');
      expect(body.field).toBe('status');
      expect(body.from).toBe('todo');
      expect(body.next?.sort()).toEqual(['backlog', 'in_progress']);
    });

    it('distinguishes "no FSM / no from" (null) from "a dead end" ([])', async () => {
      // No `?from=` — the caller asked nothing answerable, so `next` is null.
      const noFrom = await stack.apiAs(token, 'GET', '/meta/objects/showcase_task/state/status');
      expect(((await noFrom.json()) as { next: unknown }).next).toBeNull();

      // A field with no state_machine at all is also `null`, not `[]`: "nothing
      // governs this" and "this state goes nowhere" are different facts and a
      // UI has to be able to tell them apart (ADR-0020 D3.3).
      const noRule = await stack.apiAs(token, 'GET', '/meta/objects/showcase_task/state/title?from=anything');
      expect(noRule.status).toBe(200);
      expect(((await noRule.json()) as { next: unknown }).next).toBeNull();

      // An unknown state under a field that DOES have a machine is a dead end.
      const deadEnd = await stack.apiAs(token, 'GET', '/meta/objects/showcase_task/state/status?from=not_a_state');
      expect(((await deadEnd.json()) as { next: unknown }).next).toEqual([]);
    });

    it('404s for an object the registry does not know', async () => {
      const res = await stack.apiAs(token, 'GET', '/meta/objects/zzz_not_a_real_object/state/status?from=x');
      expect(res.status).toBe(404);
    });

    it('accepts the singular `/meta/object/...` spelling the dispatcher branch accepted', async () => {
      const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_task/state/status?from=todo');
      expect(res.status).toBe(200);
      expect(((await res.json()) as { next: string[] }).next.sort()).toEqual(['backlog', 'in_progress']);
    });

    it('is not the transport 404 — an unmounted control answers differently', async () => {
      // The pre-fix state of this route: Hono's `notFound`, byte-identical to a
      // path nothing mounts. Both 404s below are 404s; only one of them is a
      // HANDLER's answer, and that difference is the whole point.
      const control = await stack.apiAs(token, 'GET', '/meta/objects/showcase_task/state/status/definitely/not/mounted');
      const handled = await stack.apiAs(token, 'GET', '/meta/objects/zzz_not_a_real_object/state/status?from=x');
      expect(control.status).toBe(404);
      expect(handled.status).toBe(404);
      expect(await handled.text()).not.toBe(await control.text());
    });
  });
});
