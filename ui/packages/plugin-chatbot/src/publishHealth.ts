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
  /**
   * True when sample data did NOT land (`seedApplied.success === false`), with
   * or without a detail below. The customer's line words this itself
   * (`chatbot.build.health.seedFailed`); it never prints the detail.
   */
  seedFailed?: boolean;
  /**
   * The producer's own failure detail when sample data did NOT land — engine
   * text (`seed apply stopped at the seed for object 'x': …`), not a customer
   * sentence, so the line folds it under its technical details. Absent when
   * the producer sent no text.
   */
  seedError?: string;
  /** How many runtime probes ran per plane (`probes.checked`). */
  checked?: { seeds: number; views: number; widgets: number };
  /** Runtime findings (`probes.issues`). */
  issues?: PublishHealthIssue[];
}

/**
 * One runtime finding (`probes.issues[]`). Two readers, two channels
 * (objectstack#32984, ruling B: the producer of a finding writes the
 * customer sentence): `message` and `fix` are written for the AGENT that
 * repairs the build; `userMessage`, when the producer sends one, is the
 * sentence for the customer, already in the request's language.
 */
export interface PublishHealthIssue {
  severity: 'error' | 'warning';
  code: string;
  /** Agent-facing description of what is wrong. */
  message: string;
  /** Agent-facing repair instruction, when the producer sent one. */
  fix?: string;
  /** The producer's customer sentence, when it sent one. */
  userMessage?: string;
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
        issues?: Array<{ severity?: string; code?: string; message?: string; fix?: unknown; userMessage?: unknown }>;
      }
    | undefined;
  if (!seedApplied && !probes) return undefined;
  const health: PublishHealth = {};
  if (seedApplied) {
    if (seedApplied.success === false) {
      health.seedFailed = true;
      // objectstack#32984 — no invented English when the producer sent no
      // text: the line says the seed failed through the locale pack.
      const detail = seedFailureDetail(seedApplied);
      if (detail) health.seedError = detail;
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
      .map((i) => {
        const issue: PublishHealthIssue = {
          severity: i.severity === 'error' ? 'error' : 'warning',
          code: String(i.code ?? 'runtime_issue'),
          message: String(i.message),
        };
        const fix = nonEmptyText(i.fix);
        if (fix) issue.fix = fix;
        const userMessage = nonEmptyText(i.userMessage);
        if (userMessage) issue.userMessage = userMessage;
        return issue;
      });
  }
  return health;
}

/** A string with something in it, else undefined. */
function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * The producer's text for a failed seed load: the headline `error`, else the
 * first `errors[]` entry — a string, or a loader finding whose `message` says
 * what failed (`String()` of that object read `[object Object]`).
 */
function seedFailureDetail(seedApplied: { error?: unknown; errors?: unknown[] }): string | undefined {
  const headline = nonEmptyText(seedApplied.error);
  if (headline) return headline;
  const first = Array.isArray(seedApplied.errors) ? seedApplied.errors[0] : undefined;
  if (typeof first === 'string') return nonEmptyText(first);
  if (first && typeof first === 'object') return nonEmptyText((first as { message?: unknown }).message);
  return undefined;
}
