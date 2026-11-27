// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

/**
 * Knowledge — the settings the knowledge service and its store read. The
 * embedder itself is configured in the AI namespace (see `ai.manifest.ts`)
 * because it's shared between knowledge sources and any future agent that
 * needs to embed ad-hoc inputs.
 *
 * Every key here has a reader (ADR-0049 enforce-or-remove: a setting nothing
 * reads is not offered). The Turso group (`turso_url`, `turso_auth_token`) is
 * not declared here: its one reader, `@objectstack/knowledge-turso`, adds it
 * to this page when it reads them (`contributeKnowledgeTursoSettings`), so a
 * deployment whose store is `@objectstack/knowledge-pgvector` shows no Turso
 * fields.
 *
 *   - `chunk_target` — the knowledge service's splitter (#37098), read through
 *     `KnowledgeServicePlugin` each time it splits: the longest passage, in
 *     characters, beneath a knowledge source's own `split.maxChars`, and
 *     lowered further by the embedder's input limit. It applies to every
 *     adapter that takes the service's passages, the in-memory one included.
 *
 * The keys this page no longer offers, and why each `version` bump:
 *
 *   - 2: `chunk_overlap` — nothing ever read it; the splitter cuts without
 *     overlap, so it was retired rather than implemented (#37098).
 *   - 3: the `ragflow` adapter option and its three keys (`ragflow_base_url`,
 *     `ragflow_api_key`, `ragflow_default_dataset`), with
 *     `@objectstack/knowledge-ragflow` (#37004).
 *   - 4 (#37104): `adapter`, `over_fetch` and `enforce_rls`, none of which any
 *     code read. The store a knowledge source uses is the one its own
 *     `adapter` names, among those mounted — `requires: ['knowledge']` mounts
 *     one, chosen by the platform database (`resolveKnowledgeStore` in
 *     `@objectstack/core`) — so a page-level choice changed nothing; the
 *     `index_status` action (`os knowledge status`) answers each source's
 *     store. Search refills from fixed factors (`SEARCH_FIRST_ROUND_FACTOR`,
 *     `SEARCH_REFILL_FACTOR` in `@objectstack/service-knowledge`), never a
 *     setting. And every search re-checks each hit as the asking user
 *     (`applyPermissionFilter`), with no switch: a toggle that appeared to
 *     turn that off must not exist.
 *   - 5: `turso_url` and `turso_auth_token`, with the Turso group, leave this
 *     declaration for the store that reads them, which contributes them where
 *     it does (above). A row saved for either is kept: where the store is
 *     mounted it is read as before, elsewhere it is not served.
 *
 * The spec's `SettingsManifest.version` contract is "increment when keys are
 * renamed/removed". A `sys_setting` row stored for a removed key is kept,
 * never deleted; the service no longer resolves it, so the page loads without
 * it, and a write naming the key is refused `400 UNKNOWN_KEY`, the answer
 * every undeclared key gets.
 */
const manifest = {
  namespace: 'knowledge',
  version: 5,
  label: 'Knowledge',
  icon: 'BookOpen',
  description:
    'Vector-store backend for RAG / knowledge sources. ' +
    'The embedder is configured separately under AI.',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  category: 'Infrastructure',
  order: 35,
  specifiers: [
    // ── Indexing defaults ─────────────────────────────────────────
    { type: 'group', id: 'indexing', label: 'Indexing defaults', required: false,
      description: 'A value set on a knowledge source itself wins over these defaults.' },
    { type: 'number', key: 'chunk_target', label: 'Target chunk size (chars)',
      required: false, default: 800, min: 64, max: 8192,
      description: "Longest passage, in characters, when the knowledge service splits a document. A size set on a knowledge source itself wins; the embedding model's input limit can lower it." },

    // ── Probe ─────────────────────────────────────────────────────
    { type: 'action_button', id: 'test', label: 'Test connection',
      required: false, icon: 'Plug',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/knowledge/test' } },
  ],
};

/**
 * Knowledge — RAG vector-store backend configuration. Not in
 * `builtinSettingsManifests`: `@objectstack/service-knowledge` registers it
 * when it is mounted, so a deployment without the knowledge service offers no
 * Knowledge page (#33933).
 */
export const knowledgeSettingsManifest = manifest as unknown as SettingsManifest;

/**
 * The sentence every answer carries, so a green "Test connection" is never
 * read as a connection that succeeded.
 */
const FORM_CHECK_ONLY = 'This checks the form only — no connection was attempted.';

/**
 * Handler for `knowledge/test` ("Test connection"), registered by
 * `@objectstack/service-knowledge` with the manifest it contributes (#33933).
 *
 * It checks the libSQL fields for completeness only — a Turso auth token
 * beside a managed `libsql://` URL — and opens NO connection. It reads
 * `turso_url` and `turso_auth_token` and nothing else: the page names no
 * adapter (#37104), so a payload or a stored row still carrying `adapter`
 * (a value saved before this version) is not read, and neither is any other
 * key the page no longer declares.
 *
 * Nothing in this repository replaces it with a live probe:
 * `@objectstack/service-knowledge` registers exactly this handler, and no
 * adapter package registers `knowledge/test` (a plugin that did would call
 * `SettingsService.registerAction`, which replaces this handler). So every
 * answer says no connection was attempted, and none names a package whose
 * mounting would make this check live — none does.
 */
export const knowledgeTestActionHandler: SettingsActionHandler = async ({ values, payload }) => {
  const overrides = extractOverrides(payload);
  const merged: Record<string, unknown> = { ...values, ...overrides };

  const url = merged.turso_url;
  if (!url) {
    return {
      ok: true,
      severity: 'info',
      message:
        'No Turso URL configured — where the knowledge store is @objectstack/knowledge-turso (a platform ' +
        'database other than PostgreSQL), it uses its own file, knowledge.db under .objectstack/data/, never ' +
        'the platform database. ' +
        FORM_CHECK_ONLY,
    };
  }
  const u = String(url);
  if (u.startsWith('libsql://') && !merged.turso_auth_token) {
    return {
      ok: false,
      severity: 'error',
      message: 'Managed Turso URL requires an auth token.',
    };
  }
  return {
    ok: true,
    severity: 'info',
    message:
      `Turso URL configured (${u}). ${FORM_CHECK_ONLY} It is read at startup by the ` +
      '@objectstack/knowledge-turso plugin registered beside the knowledge service, which is the store a ' +
      'platform database other than PostgreSQL gets.',
  };
};

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}
