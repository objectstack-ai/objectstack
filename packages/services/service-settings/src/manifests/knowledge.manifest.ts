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
 * Adapter list mirrors the plugin packages currently published:
 *   - memory    @objectstack/knowledge-memory   (dev / test reference)
 *   - turso     @objectstack/knowledge-turso    (libSQL native F32_BLOB —
 *                                                works for cloud Turso AND
 *                                                local file mode)
 *   - ragflow   @objectstack/knowledge-ragflow  (external RAGFlow service)
 *
 * As with the AI manifest, the real adapter wiring happens in the
 * knowledge plugins; this manifest is the canonical settings surface
 * for "what knowledge backend is wired" and saves operators from
 * grepping defineStack() during onboarding / incident response.
 */
const manifest = {
  namespace: 'knowledge',
  version: 1,
  label: 'Knowledge',
  icon: 'BookOpen',
  description:
    'Vector-store backend for RAG / knowledge sources. ' +
    '⚠ Switching adapter does NOT migrate existing indices — documents ' +
    'indexed under the previous adapter become unreachable until ' +
    're-indexed. The embedder is configured separately under AI.',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
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
        { value: 'ragflow', label: 'RAGFlow (external)' },
      ],
    },

    // ── Turso / libSQL ────────────────────────────────────────────
    { type: 'group', id: 'turso', label: 'Turso / libSQL', required: false,
      visible: "${data.adapter === 'turso'}",
      description:
        'Works against managed Turso (libsql://…), local file (file:./knowledge.db), ' +
        'or in-memory (:memory:). For per-tenant cloud deployments, leave blank to ' +
        'reuse the tenant\'s primary libSQL connection.' },
    { type: 'text', key: 'turso_url', label: 'Connection URL', required: false,
      description: 'Examples: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:',
      visible: "${data.adapter === 'turso'}" },
    { type: 'password', key: 'turso_auth_token', label: 'Auth token',
      required: false, encrypted: true,
      description: 'Only required for managed Turso URLs. Leave blank for local file / :memory:.',
      visible: "${data.adapter === 'turso'}" },

    // ── RAGFlow ───────────────────────────────────────────────────
    { type: 'group', id: 'ragflow', label: 'RAGFlow', required: false,
      visible: "${data.adapter === 'ragflow'}",
      description: 'External RAGFlow deployment. See https://ragflow.io for self-host instructions.' },
    { type: 'text', key: 'ragflow_base_url', label: 'Base URL', required: true,
      description: 'Example: http://localhost:9380',
      visible: "${data.adapter === 'ragflow'}" },
    { type: 'password', key: 'ragflow_api_key', label: 'API key',
      required: true, encrypted: true,
      visible: "${data.adapter === 'ragflow'}" },
    { type: 'text', key: 'ragflow_default_dataset', label: 'Default dataset id',
      required: false,
      description: 'Used when a KnowledgeSource does not specify its own RAGFlow dataset.',
      visible: "${data.adapter === 'ragflow'}" },

    // ── Indexing defaults ─────────────────────────────────────────
    { type: 'group', id: 'indexing', label: 'Indexing defaults', required: false,
      description: 'Per-source values on KnowledgeSource.adapterConfig take precedence.',
      visible: "${data.adapter !== 'memory'}" },
    { type: 'number', key: 'chunk_target', label: 'Target chunk size (chars)',
      required: false, default: 800, min: 64, max: 8192,
      description: 'Soft cap on chunk size in characters before token-aware splitting kicks in.',
      visible: "${data.adapter !== 'memory'}" },
    { type: 'number', key: 'chunk_overlap', label: 'Chunk overlap (chars)',
      required: false, default: 80, min: 0, max: 2048,
      description: 'Characters retained from the previous chunk so context survives the boundary.',
      visible: "${data.adapter !== 'memory'}" },
    { type: 'number', key: 'over_fetch', label: 'Over-fetch multiplier',
      required: false, default: 4, min: 1, max: 20,
      description: 'Internal `topK * overFetch` candidates fetched so JS-side metadata filtering still has rows to return.',
      visible: "${data.adapter === 'turso'}" },

    // ── Permissions ───────────────────────────────────────────────
    { type: 'group', id: 'permissions', label: 'Permissions', required: false },
    { type: 'toggle', key: 'enforce_rls', label: 'Enforce RLS on search',
      required: false, default: true,
      description:
        'Re-check every hit against the caller\'s record-level permissions via IDataEngine. ' +
        '⚠ Disabling skips the platform\'s unique safeguard against vector-store data leakage — leave on in production.' },

    // ── Probe ─────────────────────────────────────────────────────
    { type: 'action_button', id: 'test', label: 'Test connection',
      required: false, icon: 'Plug',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/knowledge/test' } },
  ],
};

/** Knowledge — RAG vector-store backend configuration. */
export const knowledgeSettingsManifest = manifest as unknown as SettingsManifest;

/**
 * Built-in fallback handler for `knowledge/test`. The real probe with
 * a live `healthCheck()` round-trip lives in `@objectstack/service-knowledge`
 * and overrides this stub at runtime (mirrors the AI / storage patterns).
 *
 * This fallback only validates form completeness so the button is
 * usable when no knowledge adapter plugin is mounted.
 */
export const knowledgeTestActionHandler: SettingsActionHandler = async ({ values, payload }) => {
  const overrides =
    payload && typeof payload === 'object' && payload !== null && 'values' in payload
      ? ((payload as { values?: Record<string, unknown> }).values ?? {})
      : {};
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
        message: 'No URL configured — adapter will reuse the tenant\'s primary libSQL connection at runtime.',
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
      message: `Turso adapter configured (${u}). Mount @objectstack/knowledge-turso to exercise live calls.`,
    };
  }

  if (adapter === 'ragflow') {
    if (!merged.ragflow_base_url) {
      return { ok: false, severity: 'error', message: 'RAGFlow requires a Base URL.' };
    }
    if (!merged.ragflow_api_key) {
      return { ok: false, severity: 'error', message: 'RAGFlow requires an API key.' };
    }
    return {
      ok: true,
      severity: 'info',
      message: `RAGFlow adapter configured (${merged.ragflow_base_url}). Mount @objectstack/knowledge-ragflow to exercise live calls.`,
    };
  }

  return { ok: false, severity: 'error', message: `Unknown adapter: ${adapter}` };
};
