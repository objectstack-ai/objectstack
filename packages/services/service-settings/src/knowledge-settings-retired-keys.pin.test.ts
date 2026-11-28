// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An environment that saved the Knowledge page's retired keys still loads the
 * page, and none of them is read (#37104).
 *
 * The page offered keys nothing read: `adapter` (the store a source uses is
 * the one its own `adapter` names, and `requires: ['knowledge']` mounts it from
 * the platform database), `over_fetch` (search refills from fixed factors) and
 * `enforce_rls` (every search re-checks each hit as the asking user, with no
 * switch). Manifest `version` 4 retires all three, as earlier versions retired
 * `chunk_overlap` and the RAGFlow keys. A deployment upgraded from any of them
 * keeps those `sys_platform_setting` rows; the settings service never deletes
 * a stored row. This file pins what such an environment gets, through the real
 * settings routes over the real `ObjectQL` engine:
 *
 *   - `GET /api/settings/knowledge` answers 200 with the declared keys only —
 *     the stored retired rows (an encrypted one with a dangling secret handle
 *     included) neither fail the read nor appear in it, and a stored
 *     `enforce_rls = false` shows no toggle and is reported nowhere;
 *   - the page has no "Test connection" (it checks the Turso fields, and
 *     arrives with them), so its door answers as for any undeclared action;
 *   - saving a declared key works beside them, and leaves them stored;
 *   - a write naming a retired key is refused `400 UNKNOWN_KEY`, and refused
 *     WHOLE: no other key in that body is saved.
 *
 * Version 5 moves the Turso group (`turso_url`, `turso_auth_token`) to the
 * store that reads it, `@objectstack/knowledge-turso`, which adds it to this
 * page where it is mounted. The page this file boots is the one a deployment
 * that does not mount that store serves (its store is pgvector): a saved
 * `turso_url` stays stored and is not served, a write of either key is
 * refused, and once a page declaring the group is registered again — what the
 * store's contribution does — the same stored row is served as before.
 * knowledge-turso's own tests pin the contribution on a real kernel.
 *
 * Refusals are pinned by envelope (status + `error.code`), what a console or
 * API caller reads.
 */

import { describe, it, expect } from 'vitest';
import { bootSettingsDoor } from './__tests__/settings-door.testkit.js';
import type { SettingsManifest } from '@objectstack/spec/system';
import { knowledgeSettingsManifest } from './manifests/knowledge.manifest.js';

const RETIRED_KEYS = [
  'adapter',
  'over_fetch',
  'enforce_rls',
  'chunk_overlap',
  'ragflow_base_url',
  'ragflow_api_key',
  'ragflow_default_dataset',
] as const;

/** The keys @objectstack/knowledge-turso contributes to this page where it is mounted (version 5). */
const TURSO_KEYS = ['turso_url', 'turso_auth_token'] as const;

async function bootWithRetiredRows() {
  const door = await bootSettingsDoor(knowledgeSettingsManifest);
  // Every value as an earlier version stored it, `enforce_rls = false` among
  // them, beside two declared keys holding saved values of their own.
  door.seed({ id: 'ps_adapter', namespace: 'knowledge', key: 'adapter', value: 'ragflow' });
  door.seed({ id: 'ps_over_fetch', namespace: 'knowledge', key: 'over_fetch', value: 8 });
  door.seed({ id: 'ps_enforce_rls', namespace: 'knowledge', key: 'enforce_rls', value: false });
  door.seed({ id: 'ps_chunk_overlap', namespace: 'knowledge', key: 'chunk_overlap', value: 100 });
  door.seed({ id: 'ps_rf_url', namespace: 'knowledge', key: 'ragflow_base_url', value: 'http://localhost:9380' });
  // An encrypted row whose secret handle resolves to nothing: a retired key is
  // never resolved, so the handle is never read.
  door.seed({ id: 'ps_rf_key', namespace: 'knowledge', key: 'ragflow_api_key', value: null, encrypted: true, value_enc: 'sec_retired_handle' });
  door.seed({ id: 'ps_rf_ds', namespace: 'knowledge', key: 'ragflow_default_dataset', value: 'kb' });
  door.seed({ id: 'ps_chunk_target', namespace: 'knowledge', key: 'chunk_target', value: 500 });
  door.seed({ id: 'ps_turso_url', namespace: 'knowledge', key: 'turso_url', value: 'file:./kb.db' });
  return door;
}

describe('#37104 — the Knowledge page with stored values for its retired keys', () => {
  it('loads: 200, the declared keys only, their saved values served', async () => {
    const { request } = await bootWithRetiredRows();
    const page = await request('GET /api/settings/:namespace', { namespace: 'knowledge' });
    expect(page.status).toBe(200);
    const values = page.body?.data?.values ?? {};
    expect(Object.keys(values).sort()).toEqual(['chunk_target']);
    // Non-vacuity: the stored rows ARE read for the keys the page declares.
    expect(values.chunk_target).toMatchObject({ value: 500, source: 'global' });
    const served = (page.body?.data?.manifest?.specifiers ?? []) as Array<{ key?: string }>;
    for (const key of [...RETIRED_KEYS, ...TURSO_KEYS]) {
      expect(values, key).not.toHaveProperty(key);
      expect(served.some((s) => s.key === key), key).toBe(false);
    }
  });

  it('a stored enforce_rls = false shows no toggle and reaches no reader', async () => {
    const { request, stored } = await bootWithRetiredRows();
    // The row is there …
    expect(stored('enforce_rls')).toMatchObject({ value: false });
    // … and the page neither offers the switch nor reports the stored value.
    const page = await request('GET /api/settings/:namespace', { namespace: 'knowledge' });
    expect(JSON.stringify(page.body?.data ?? {})).not.toMatch(/enforce_rls|Enforce RLS/);
  });

  it('has no "Test connection": its door answers as for an action the page never declared', async () => {
    const { request } = await bootWithRetiredRows();
    const post = (actionId: string) =>
      request('POST /api/settings/:namespace/:actionId', { namespace: 'knowledge', actionId }, { values: { turso_url: 'file:./sent.db' } });
    const answer = await post('test');
    const control = await post('never_declared');
    expect(answer.status).toBe(400);
    expect(answer.body?.error?.code).toBe('SETTINGS_ACTION_FAILED');
    expect([control.status, control.body?.error?.code]).toEqual([answer.status, answer.body?.error?.code]);
    expect(answer.body?.error?.details).toMatchObject({ ok: false, severity: 'error' });
    // Never the Turso check's answer, and never one read from the stored `adapter`.
    expect(JSON.stringify(answer.body)).not.toMatch(/sent\.db|ragflow/i);
  });

  it('saving a declared key works beside the retired rows, and leaves them stored', async () => {
    const { save, stored } = await bootWithRetiredRows();
    const write = await save({ chunk_target: 600 });
    expect(write.status).toBe(200);
    expect(stored('chunk_target')).toMatchObject({ value: 600 });
    for (const key of RETIRED_KEYS) expect(stored(key), key).toBeDefined();
    expect(stored('turso_url')).toMatchObject({ value: 'file:./kb.db' });
  });

  it('a write naming a retired key is refused as an undeclared key', async () => {
    const { save, stored } = await bootWithRetiredRows();
    for (const [key, value] of [['adapter', 'turso'], ['over_fetch', 4], ['enforce_rls', true]] as const) {
      const write = await save({ [key]: value });
      expect(write.status, key).toBe(400);
      expect(write.body?.error?.code, key).toBe('UNKNOWN_KEY');
    }
    // The refused writes changed nothing stored.
    expect(stored('enforce_rls')).toMatchObject({ value: false });
    expect(stored('adapter')).toMatchObject({ value: 'ragflow' });
  });

  // The migration note's claim: a body carrying a retired key is refused
  // whole, so a script that still sends `adapter` beside a real change saves
  // neither until it drops the retired key.
  it('a write naming a retired key beside chunk_target is refused whole: chunk_target is not saved', async () => {
    const { save, stored } = await bootWithRetiredRows();
    for (const [key, value] of [['adapter', 'turso'], ['over_fetch', 4], ['enforce_rls', true]] as const) {
      const write = await save({ [key]: value, chunk_target: 600 });
      expect(write.status, key).toBe(400);
      expect(write.body?.error?.code, key).toBe('UNKNOWN_KEY');
      expect(stored('chunk_target'), key).toMatchObject({ value: 500 });
    }
    // Control: the same chunk_target alone is saved, so the refusal above is
    // the retired key's, not the value's.
    expect((await save({ chunk_target: 600 })).status).toBe(200);
    expect(stored('chunk_target')).toMatchObject({ value: 600 });
  });
});

/** The Turso group as @objectstack/knowledge-turso adds it: the same keys, in front of the page. */
function withTursoSection(page: SettingsManifest): SettingsManifest {
  return {
    ...page,
    specifiers: [
      { type: 'group', id: 'turso', label: 'Turso / libSQL', required: false },
      { type: 'text', key: 'turso_url', label: 'Connection URL', required: false },
      { type: 'password', key: 'turso_auth_token', label: 'Auth token', required: false, encrypted: true },
      ...page.specifiers,
    ] as SettingsManifest['specifiers'],
  };
}

describe('version 5 — the Turso fields where knowledge-turso is not mounted, and their stored values', () => {
  it('a saved turso_url is kept and not served; a write of either Turso key is refused', async () => {
    const { request, save, stored } = await bootWithRetiredRows();
    const page = await request('GET /api/settings/:namespace', { namespace: 'knowledge' });
    expect(page.status).toBe(200);
    expect(page.body?.data?.values ?? {}).not.toHaveProperty('turso_url');
    for (const [key, value] of [['turso_url', 'file:./other.db'], ['turso_auth_token', 'tok']] as const) {
      const write = await save({ [key]: value });
      expect(write.status, key).toBe(400);
      expect(write.body?.error?.code, key).toBe('UNKNOWN_KEY');
    }
    expect(stored('turso_url')).toMatchObject({ value: 'file:./kb.db' });
    expect(stored('turso_auth_token')).toBeUndefined();
  });

  it('once the store contributes the group again, the same stored turso_url is served, and saves', async () => {
    const { svc, request, save, stored } = await bootWithRetiredRows();
    svc.registerAction('knowledge', 'probe', async ({ values }) => ({
      ok: true, severity: 'info', message: `turso_url is ${String(values.turso_url)}`,
    }));
    svc.registerManifest(withTursoSection(knowledgeSettingsManifest));
    const page = await request('GET /api/settings/:namespace', { namespace: 'knowledge' });
    expect(page.status).toBe(200);
    expect(page.body?.data?.values?.turso_url).toMatchObject({ value: 'file:./kb.db', source: 'global' });
    // The door that refused the key above takes it now.
    const write = await save({ turso_url: 'file:./other.db' });
    expect(write.status).toBe(200);
    expect(stored('turso_url')).toMatchObject({ value: 'file:./other.db' });
    // And an action registered before the re-registration is still answered:
    // re-registering a page keeps its handlers.
    const answer = await request('POST /api/settings/:namespace/:actionId', { namespace: 'knowledge', actionId: 'probe' }, {});
    expect(answer.status).toBe(200);
    expect(String(answer.body?.data?.message)).toContain('file:./other.db');
  });
});
