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
 *   - "Test connection" answers from the declared Turso fields, never from the
 *     stored `adapter`;
 *   - saving a declared key works beside them, and leaves them stored;
 *   - a write naming a retired key is refused `400 UNKNOWN_KEY`.
 *
 * Refusals are pinned by envelope (status + `error.code`), what a console or
 * API caller reads.
 */

import { describe, it, expect } from 'vitest';
import { bootSettingsDoor } from './__tests__/settings-door.testkit.js';
import { knowledgeSettingsManifest, knowledgeTestActionHandler } from './manifests/knowledge.manifest.js';

const RETIRED_KEYS = [
  'adapter',
  'over_fetch',
  'enforce_rls',
  'chunk_overlap',
  'ragflow_base_url',
  'ragflow_api_key',
  'ragflow_default_dataset',
] as const;

async function bootWithRetiredRows() {
  const door = await bootSettingsDoor(knowledgeSettingsManifest);
  door.svc.registerAction('knowledge', 'test', knowledgeTestActionHandler);
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
    expect(Object.keys(values).sort()).toEqual(['chunk_target', 'turso_auth_token', 'turso_url']);
    // Non-vacuity: the stored rows ARE read for the keys the page declares.
    expect(values.chunk_target).toMatchObject({ value: 500, source: 'global' });
    expect(values.turso_url).toMatchObject({ value: 'file:./kb.db', source: 'global' });
    const served = (page.body?.data?.manifest?.specifiers ?? []) as Array<{ key?: string }>;
    for (const key of RETIRED_KEYS) {
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

  it('"Test connection" answers from the Turso fields, never from the stored adapter', async () => {
    const { request } = await bootWithRetiredRows();
    const answer = await request(
      'POST /api/settings/:namespace/:actionId',
      { namespace: 'knowledge', actionId: 'test' },
      {},
    );
    // Before version 4 a stored `adapter = ragflow` answered "Unknown adapter".
    expect(answer.status).toBe(200);
    expect(answer.body?.data?.ok).toBe(true);
    expect(String(answer.body?.data?.message)).toContain('file:./kb.db');
    expect(String(answer.body?.data?.message)).not.toMatch(/Unknown adapter|ragflow/i);
  });

  it('saving a declared key works beside the retired rows, and leaves them stored', async () => {
    const { save, stored } = await bootWithRetiredRows();
    const write = await save({ chunk_target: 600 });
    expect(write.status).toBe(200);
    expect(stored('chunk_target')).toMatchObject({ value: 600 });
    for (const key of RETIRED_KEYS) expect(stored(key), key).toBeDefined();
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
});
