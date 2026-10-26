/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Publish-health extraction, dependency-free so `@object-ui/plugin-chatbot/core`
 * can serve it to the console shell without the chat UI (objectui#13410).
 * `ChatbotEnhanced` re-exports all three names unchanged.
 */

/**
 * ADR-0038 L3 — what a publish actually did at runtime. Hosts extract this
 * from the publish-drafts response (`seedApplied` + `probes`) so the chat can
 * render a build-health line: "Published" and "actually works" are two
 * separately-verified statements, and the second one must be visible too.
 */
export interface PublishHealth {
  /** Rows materialized by published seeds (`seedApplied` inserted+updated). */
  seededRows?: number;
  /** Seed-load failure detail when sample data did NOT land. */
  seedError?: string;
  /** How many runtime probes ran per plane (`probes.checked`). */
  checked?: { seeds: number; views: number; widgets: number };
  /** Runtime findings (`probes.issues`), already human-readable. */
  issues?: Array<{ severity: 'error' | 'warning'; code: string; message: string }>;
}

/** Structured result of `onPublishDrafts` — richer alternative to a bare boolean. */
export interface PublishOutcome {
  ok: boolean;
  health?: PublishHealth;
}

/**
 * Extract {@link PublishHealth} from a publish-drafts response body (tolerant
 * of the dispatcher's `{ success, data }` envelope). Shared by the hosts that
 * wire `onPublishDrafts` so they all read `seedApplied` + `probes` the same
 * way; returns undefined when the server reported neither (older runtimes).
 */
export function publishHealthFromResponse(payload: unknown): PublishHealth | undefined {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
  const seedApplied = data.seedApplied as
    | { success?: boolean; inserted?: number; updated?: number; error?: string; errors?: unknown[] }
    | undefined;
  const probes = data.probes as
    | {
        checked?: { seeds?: number; views?: number; widgets?: number };
        issues?: Array<{ severity?: string; code?: string; message?: string }>;
      }
    | undefined;
  if (!seedApplied && !probes) return undefined;
  const health: PublishHealth = {};
  if (seedApplied) {
    if (seedApplied.success === false) {
      health.seedError =
        seedApplied.error ??
        (Array.isArray(seedApplied.errors) && seedApplied.errors.length
          ? String(seedApplied.errors[0])
          : 'Sample data failed to load.');
    } else {
      health.seededRows = (seedApplied.inserted ?? 0) + (seedApplied.updated ?? 0);
    }
  }
  if (probes) {
    health.checked = {
      seeds: probes.checked?.seeds ?? 0,
      views: probes.checked?.views ?? 0,
      widgets: probes.checked?.widgets ?? 0,
    };
    health.issues = (probes.issues ?? [])
      .filter((i) => i && typeof i.message === 'string')
      .map((i) => ({
        severity: i.severity === 'error' ? 'error' : 'warning',
        code: String(i.code ?? 'runtime_issue'),
        message: String(i.message),
      }));
  }
  return health;
}
