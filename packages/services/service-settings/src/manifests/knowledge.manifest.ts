// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

/**
 * Knowledge — RAG infrastructure: which adapter stores vectors, and
 * how big chunks are. The embedder itself is configured in the AI
 * namespace (see `ai.manifest.ts`) because it's shared between
 * knowledge sources and any future agent that needs to embed ad-hoc
 * inputs.
 *
 * Adapter list — every one of these plugin packages is built in this repo:
 *   - memory    @objectstack/knowledge-memory   (dev / test ref)
 *   - turso     @objectstack/knowledge-turso    libSQL native vectors, in a
 *                                               file of its own or on Turso;
 *                                               built here since #37107 (its
 *                                               6.x releases came from the
 *                                               ObjectOS Cloud monorepo)
 *
 * Only `turso` reads this namespace, and only `turso_url` and
 * `turso_auth_token`, when the runtime mounts it for `requires:
 * ['knowledge']` (#37102): a `file:` URL saved there is held to the project's
 * `.objectstack/data/` directory and a URL with a NUL byte is refused, before
 * it reaches the libSQL client. Every other adapter is registered by the
 * deployment beside the knowledge service itself.
 *
 * As with the AI manifest, the real adapter wiring happens in the
 * knowledge plugins; this manifest is the canonical settings surface
 * for "what knowledge backend is wired" and saves operators from
 * grepping defineStack() during onboarding / incident response.
 *
 * `chunk_target` is read by the knowledge service's splitter (#37098): the
 * longest passage, in characters, beneath a knowledge source's own
 * `split.maxChars`, and lowered further by the embedder's input limit. It
 * applies to every adapter that takes the service's passages, the in-memory
 * one included. `chunk_overlap` was offered here until #37098 and nothing
 * ever read it; the splitter cuts without overlap, so it was retired rather
 * than implemented. Removing it is why `version` is 2 (the spec's
 * `SettingsManifest.version` contract: "increment when keys are
 * renamed/removed"). A `sys_setting` row stored for it is kept, never
 * deleted; the service no longer resolves it, and a write naming the key is
 * refused `400 UNKNOWN_KEY`, the answer every undeclared key gets.
 *
 * `version` is 3 for the same reason: the `ragflow` adapter option and its
 * three keys (`ragflow_base_url`, `ragflow_api_key`, `ragflow_default_dataset`)
 * were removed when `@objectstack/knowledge-ragflow` was retired. Stored rows
 * for those keys are kept, never deleted; the service no longer serves them,
 * and a write naming one is refused `400 UNKNOWN_KEY`. A stored
 * `adapter = ragflow` is still served as stored; saving that value again is
 * refused `400 SETTINGS_VALIDATION` (`invalid_option`), and "Test connection"
 * answers it as an unknown adapter.
 */
const manifest = {
  namespace: 'knowledge',
  version: 3,
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
    // ── Adapter selection ─────────────────────────────────────────
    { type: 'group', id: 'adapter', label: 'Backend', required: false,
      description: 'Choose where document chunks and their vectors are stored.' },
    { type: 'select', key: 'adapter', label: 'Adapter', required: true, default: 'memory',
      options: [
        { value: 'memory', label: 'In-memory (dev / test only)' },
        { value: 'turso', label: 'Turso / libSQL (cloud or local)' },
      ],
    },
    // Warnings are `info_banner` rows with `bannerSeverity: 'warning'`, never a
    // sentence inside a description; each `id` addresses its copy under
    // `settings.knowledge.banners.<id>` in the locale bundles.
    { type: 'info_banner', id: 'adapter_switch_warning', label: 'Existing indices are not migrated',
      required: false, bannerSeverity: 'warning',
      bannerText:
        'Switching adapter does NOT migrate existing indices — documents indexed under the ' +
        'previous adapter become unreachable until re-indexed.' },

    // ── Turso / libSQL ────────────────────────────────────────────
    { type: 'group', id: 'turso', label: 'Turso / libSQL', required: false,
      visible: "${data.adapter === 'turso'}",
      description:
        'Works against managed Turso (libsql://…), local file (file:./knowledge.db), ' +
        'or in-memory (:memory:). In a cloud deployment with a database per organization, leave blank to ' +
        'reuse that organization\'s own database connection.' },
    { type: 'text', key: 'turso_url', label: 'Connection URL', required: false,
      description: 'Examples: libsql://your-tenant.turso.io · file:./.objectstack/data/knowledge.db · :memory:',
      visible: "${data.adapter === 'turso'}" },
    { type: 'password', key: 'turso_auth_token', label: 'Auth token',
      required: false, encrypted: true,
      description: 'Only required for managed Turso URLs. Leave blank for local file / :memory:.',
      visible: "${data.adapter === 'turso'}" },

    // ── Indexing defaults ─────────────────────────────────────────
    { type: 'group', id: 'indexing', label: 'Indexing defaults', required: false,
      description: 'A value set on a knowledge source itself wins over these defaults.' },
    { type: 'number', key: 'chunk_target', label: 'Target chunk size (chars)',
      required: false, default: 800, min: 64, max: 8192,
      description: "Longest passage, in characters, when the knowledge service splits a document. A size set on a knowledge source itself wins; the embedding model's input limit can lower it." },
    { type: 'number', key: 'over_fetch', label: 'Over-fetch multiplier',
      required: false, default: 4, min: 1, max: 20,
      description: 'Search fetches this many times the requested number of results, so enough are left to return after they are filtered by document details.',
      visible: "${data.adapter === 'turso'}" },

    // ── Permissions ───────────────────────────────────────────────
    { type: 'group', id: 'permissions', label: 'Permissions', required: false },
    { type: 'toggle', key: 'enforce_rls', label: 'Enforce RLS on search',
      required: false, default: true,
      description: 'Re-check every hit against the caller\'s record-level permissions.' },
    { type: 'info_banner', id: 'enforce_rls_warning', label: 'Leave RLS on in production',
      required: false, bannerSeverity: 'warning',
      bannerText:
        'Disabling skips the platform\'s unique safeguard against vector-store data leakage — ' +
        'leave on in production.' },

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
 * The sentence every answer on a remote adapter carries, so a green "Test
 * connection" is never read as a connection that succeeded.
 */
const FORM_CHECK_ONLY = 'This checks the form only — no connection was attempted.';

/**
 * Handler for `knowledge/test` ("Test connection"), registered by
 * `@objectstack/service-knowledge` with the manifest it contributes (#33933).
 *
 * It checks form completeness only — a Turso auth token beside a managed
 * `libsql://` URL — and opens NO connection.
 * Nothing in this repository replaces it with a live probe:
 * `@objectstack/service-knowledge` registers exactly this handler, and no
 * adapter package reads this namespace or registers `knowledge/test` (a
 * plugin that did would call
 * `SettingsService.registerAction`, which replaces this handler). So every
 * answer on a remote adapter says no connection was attempted, and none names
 * a package whose mounting would make this check live — none does.
 */
export const knowledgeTestActionHandler: SettingsActionHandler = async ({ values, payload }) => {
  const overrides = extractOverrides(payload);
  const merged: Record<string, unknown> = { ...values, ...overrides };
  const adapter = String(merged.adapter ?? 'memory');

  if (adapter === 'memory') {
    return {
      ok: true,
      severity: 'warning',
      message: 'In-memory adapter — no external service to probe. Indices are wiped on restart; do not use in production.',
    };
  }

  if (adapter === 'turso') {
    const url = merged.turso_url;
    if (!url) {
      return {
        ok: true,
        severity: 'info',
        message:
          'No URL configured — the @objectstack/knowledge-turso plugin defaults to its own file, ' +
          'knowledge.db under .objectstack/data/, never the platform database. ' +
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
        `Turso adapter configured (${u}). ${FORM_CHECK_ONLY} Live calls need the ` +
        '@objectstack/knowledge-turso plugin registered beside the knowledge service, with this URL.',
    };
  }

  return { ok: false, severity: 'error', message: `Unknown adapter: ${adapter}` };
};

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}
