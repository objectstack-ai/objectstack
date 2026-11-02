// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0067 — the per-commit revert and the rollback act only on a commit of
// the package their path names, over the real showcase composition and
// through the REST doors.
//
// ## What was broken
//
// `POST /api/v1/packages/B/commits/COMMIT_OF_A/revert` read the commit id from
// the path and never read the package id beside it: it answered 200, reverted
// package A's items, and recorded a "Revert: …" commit in A's history.
// `POST /api/v1/packages/B/rollback` with `{ commitId: COMMIT_OF_A }` did the
// same through A's whole timeline.
//
// ## What these cases pin
//
// A commit of another package answers `404 COMMIT_NOT_FOUND` naming the
// commit as not in the path's package, and writes nothing: the items are
// untouched and the commit's own package keeps the history it had. An
// unknown package id answers the sibling doors' `404 Package 'ID' not found`.
// A package that was installed, committed to and then uninstalled is an
// unknown id too: its commits stay in the trail (`GET /:id/commits` still
// lists them), and its own revert and rollback paths answer that same 404
// and write nothing.
// Controls: the same revert and rollback through the commit's own package
// still answer 200 and record their commits; a member without
// `manage_metadata` is still refused 403 first.
//
// ## Read-only packages carry commits too, and keep their revert
//
// Measured on main: an environment overlay draft on a showcase item, bound to
// `com.example.showcase` (a booted code package, read-only) and published with
// `publish-drafts`, records an `apply` commit in the showcase's history, and
// reverting it through the showcase's own path removes the overlay. That is
// the undo of an ADR-0131 D6 customization, which `POST /packages/:id/revert`
// also answers for a read-only package (stored rows first), so the commit
// doors take no read-only guard.
//
// [#28905, ADR-0146 D1] That draft naming the read-only showcase itself is
// refused now (`403 NOT_OVERRIDABLE`, naming its `.custom` pair), so a fresh
// boot can no longer give the showcase such a commit; one recorded before
// keeps its revert, as the commit doors still take no read-only guard. The
// last case pins the refusal, then the same customization written where D1
// puts it, the showcase's pair: its commit reverts through the pair's own
// path, and through no other.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { declaredOverride, ensurePair, inPair } from './customization-pair.js';

const SHOWCASE = 'com.example.showcase';
const OVERLAY = 'showcase_task.default';
const A = 'app.cmtprobe-a';
const B = 'app.cmtprobe-b';
const GONE = 'app.cmtprobe-gone';

const object = (name: string, label: string) => ({
  name,
  label,
  sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});

interface Commit { id: string; operation: string; message?: string }

describe('dogfood: package commit revert and rollback act only on a commit of the path\'s package (ADR-0067)', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;

  const call = async (method: string, path: string, body?: unknown, token = admin) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const commitsOf = async (pkg: string): Promise<Commit[]> => {
    const res = await call('GET', `/packages/${pkg}/commits`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return (res.json?.data?.commits ?? []) as Commit[];
  };
  const publishObject = async (pkg: string, name: string, label: string) => {
    const saved = await call('PUT', `/meta/object/${name}?mode=draft&package=${pkg}`, object(name, label));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const published = await call('POST', `/packages/${pkg}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
  };
  const isServed = async (name: string) => (await call('GET', `/meta/object/${name}`)).status === 200;

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    member = await stack.signUp('member.commit-revert@verify.test');
    for (const [id, ns] of [[A, 'cmtpa'], [B, 'cmtpb']] as const) {
      const created = await call('POST', '/packages', {
        manifest: { id, name: `Commit probe ${ns}`, version: '0.1.0', type: 'app', namespace: ns },
      });
      expect(created.status, JSON.stringify(created.json)).toBe(201);
    }
    await publishObject(A, 'cmtpa_first', 'A first');
    await publishObject(A, 'cmtpa_second', 'A second');
    await publishObject(B, 'cmtpb_first', 'B first');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the card: a commit of A reverted through B\'s path is 404 and writes nothing', async () => {
    const before = await commitsOf(A);
    const target = before.find((c) => c.operation === 'apply')!;
    const res = await call('POST', `/packages/${B}/commits/${target.id}/revert`, {});
    expect(res.status, JSON.stringify(res.json)).toBe(404);
    expect(JSON.stringify(res.json)).toContain('COMMIT_NOT_FOUND');
    expect(await commitsOf(A)).toEqual(before);
    expect(await isServed('cmtpa_first')).toBe(true);
    expect(await isServed('cmtpa_second')).toBe(true);
  });

  it('a rollback of B to a commit of A is 404 and writes nothing', async () => {
    const before = await commitsOf(A);
    const oldest = before[before.length - 1];
    const res = await call('POST', `/packages/${B}/rollback`, { commitId: oldest.id });
    expect(res.status, JSON.stringify(res.json)).toBe(404);
    expect(JSON.stringify(res.json)).toContain('COMMIT_NOT_FOUND');
    expect(await commitsOf(A)).toEqual(before);
    expect(await commitsOf(B)).toHaveLength(1);
    expect(await isServed('cmtpa_second')).toBe(true);
  });

  it('an unknown package id answers the sibling doors\' package-not-found 404', async () => {
    const target = (await commitsOf(A))[0];
    const revert = await call('POST', `/packages/app.cmtprobe-nosuch/commits/${target.id}/revert`, {});
    expect(revert.status, JSON.stringify(revert.json)).toBe(404);
    expect(JSON.stringify(revert.json)).toContain("Package 'app.cmtprobe-nosuch' not found");
    const rollback = await call('POST', '/packages/app.cmtprobe-nosuch/rollback', { commitId: target.id });
    expect(rollback.status, JSON.stringify(rollback.json)).toBe(404);
    expect(JSON.stringify(rollback.json)).toContain("Package 'app.cmtprobe-nosuch' not found");
  });

  it('an uninstalled package\'s commit is refused 404 through its own revert and rollback path, and writes nothing', async () => {
    const created = await call('POST', '/packages', {
      manifest: { id: GONE, name: 'Commit probe gone', version: '0.1.0', type: 'app', namespace: 'cmtpg' },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    await publishObject(GONE, 'cmtpg_first', 'Gone first');
    const before = await commitsOf(GONE);
    const target = before.find((c) => c.operation === 'apply')!;
    expect(target).toBeDefined();

    const uninstalled = await call('DELETE', `/packages/${GONE}`);
    expect(uninstalled.status, JSON.stringify(uninstalled.json)).toBe(200);
    expect(await isServed('cmtpg_first')).toBe(false);
    // The trail outlives the package's registry entry.
    expect(await commitsOf(GONE)).toEqual(before);

    const revert = await call('POST', `/packages/${GONE}/commits/${target.id}/revert`, {});
    expect(revert.status, JSON.stringify(revert.json)).toBe(404);
    expect(revert.json?.error?.code, JSON.stringify(revert.json)).toBe('RESOURCE_NOT_FOUND');
    expect(revert.json?.error?.message).toBe(`Package '${GONE}' not found`);
    const rollback = await call('POST', `/packages/${GONE}/rollback`, { commitId: target.id });
    expect(rollback.status, JSON.stringify(rollback.json)).toBe(404);
    expect(rollback.json?.error?.code, JSON.stringify(rollback.json)).toBe('RESOURCE_NOT_FOUND');
    expect(rollback.json?.error?.message).toBe(`Package '${GONE}' not found`);

    expect(await commitsOf(GONE)).toEqual(before);
    expect(await isServed('cmtpg_first')).toBe(false);
  });

  it('control: a member without manage_metadata is refused 403 first', async () => {
    const target = (await commitsOf(A))[0];
    expect((await call('POST', `/packages/${B}/commits/${target.id}/revert`, {}, member)).status).toBe(403);
    expect((await call('POST', `/packages/${B}/rollback`, { commitId: target.id }, member)).status).toBe(403);
  });

  it('control: A\'s newest commit reverts through A\'s own path, as before', async () => {
    const before = await commitsOf(A);
    const newest = before[0];
    const res = await call('POST', `/packages/${A}/commits/${newest.id}/revert`, {});
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json?.data).toMatchObject({ success: true, revertedCount: 1, failedCount: 0 });
    const after = await commitsOf(A);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ operation: 'revert', id: res.json.data.revertCommitId });
    expect(await isServed('cmtpa_second')).toBe(false);
  });

  it('control: B rolls back to its own first commit through B\'s path, as before', async () => {
    await publishObject(B, 'cmtpb_second', 'B second');
    const before = await commitsOf(B);
    const oldest = before[before.length - 1];
    const res = await call('POST', `/packages/${B}/rollback`, { commitId: oldest.id });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json?.data).toMatchObject({ success: true, revertedCommits: [before[0].id], failed: [] });
    expect(await commitsOf(B)).toHaveLength(before.length + 1);
    expect(await isServed('cmtpb_second')).toBe(false);
    expect(await isServed('cmtpb_first')).toBe(true);
  });

  it('control: the showcase\'s customization commit, in its pair, reverts through the pair\'s own path, and through no other', async () => {
    const view = {
      name: OVERLAY, object: 'showcase_task', viewKind: 'list', label: 'Overlay probe',
      config: { type: 'grid', columns: [{ field: 'title' }] },
    };
    // [#28905] The draft naming the read-only showcase itself is closed, naming its pair.
    const named = await call('PUT', `/meta/view/${OVERLAY}?mode=draft&package=${SHOWCASE}`, view);
    expect(named.status, JSON.stringify(named.json)).toBe(403);
    expect(JSON.stringify(named.json)).toContain(`?package=${SHOWCASE}.custom`);

    const pair = await ensurePair(stack, admin, SHOWCASE);
    const saved = await call('PUT', inPair(`/meta/view/${OVERLAY}?mode=draft`, SHOWCASE), declaredOverride(view, SHOWCASE, '0.1.0'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const published = await call('POST', `/packages/${pair}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    const before = await commitsOf(pair);
    expect(before[0]).toMatchObject({ operation: 'apply', id: published.json?.data?.commitId });

    const cross = await call('POST', `/packages/${B}/commits/${before[0].id}/revert`, {});
    expect(cross.status, JSON.stringify(cross.json)).toBe(404);
    expect(await commitsOf(pair)).toEqual(before);

    const res = await call('POST', `/packages/${pair}/commits/${before[0].id}/revert`, {});
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json?.data).toMatchObject({
      success: true, revertedCount: 1, reverted: [{ type: 'view', name: OVERLAY, action: 'removed' }],
    });
    expect(await commitsOf(pair)).toHaveLength(before.length + 1);
  });
});
