/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pre-publish security-posture lint (ADR-0090 D7) — the "fail early, not at
 * publish" half of `7a90afdf9`.
 *
 * The publish door refuses an object whose record-sharing baseline was never
 * authored (`security-owd-unset`), and it is RIGHT to: the OWD must be a
 * decision, not an accident. What was wrong was the delivery — nothing between
 * "create object" and "Publish all" hinted the object was unpublishable, so
 * the rule was reachable only by failing, as a wall of English ADR prose in a
 * toast that then disappeared on a timer.
 *
 * This module runs the SAME rule the door runs — `validateSecurityPosture`
 * from `@objectstack/lint`, the framework's own `(stack) => SecurityFinding[]`
 * function — over the pending drafts, so the review sheet can name the problem
 * one click BEFORE the publish instead of one click after. It is a mirror of
 * the producer's rule, never a second implementation of it: a re-derived "is
 * sharingModel missing" check in the console would be a fork of a security
 * gate, free to drift from the door it claims to predict.
 *
 * ## It reports; it never blocks
 *
 * The server door stays the authority. The installed `@objectstack/lint` can
 * legitimately differ from the version the server enforces, so a finding here
 * is a warning to act on, not a veto — the Publish button stays live. The
 * inverse (a console that refuses a publish the server would have accepted) is
 * the worse failure, because it has no override.
 *
 * ## Errors only, and why
 *
 * `validateSecurityPosture` spans six collections; this pass hands it only the
 * object drafts, so rules keyed on permissions/positions/apps/books simply
 * find nothing to say. Of what remains, only `severity: 'error'` findings are
 * surfaced: those are the ones that mirror a hard runtime/publish refusal (the
 * module's own header states this division — `error` rules each mirror an
 * enforcement point, the rest flag *likely* misconfiguration). A `warning` or
 * `info` rule decided on a partial stack would be advice computed from
 * incomplete input, and advice that is sometimes wrong next to a Publish
 * button is how a real signal gets learned as noise.
 *
 * ## Progressive enhancement + dynamic import (both load-bearing)
 *
 * Mirrors `capabilityLint.ts`: feature-detect the export, swallow every
 * failure, no-op against a lint package that lacks it. The `import()` must
 * stay DYNAMIC — `@objectstack/lint` is the one `@objectstack/*` package the
 * console's `vendor-objectstack` chunk group does not claim (objectui#5266,
 * recorded in DraftChangesPanel's own import note), so a static import would
 * pull the whole lint bundle onto the eager console graph.
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';

interface PendingDraft {
  type: string;
  name: string;
  packageId: string | null;
}

/** Shape of `@objectstack/lint`'s `SecurityFinding` (structural, not imported). */
export interface SecurityPostureFinding {
  severity: string;
  /** Diagnostic rule id, e.g. `security-owd-unset`. */
  rule: string;
  /** Human-readable location, e.g. `object "crmext_visit"`. */
  where: string;
  /** Config path, e.g. `objects[0].sharingModel`. */
  path: string;
  message: string;
  hint?: string;
}

/** A blocking finding, re-anchored on the draft it belongs to. */
export interface DraftSecurityProblem {
  /** Metadata type of the offending draft (always `object` today). */
  type: string;
  /** Draft name — what the author clicks in the review sheet. */
  name: string;
  rule: string;
  /** The rule's fix-it hint, which is the actionable half of the finding. */
  hint: string;
  message: string;
}

type SecurityRule = (stack: Record<string, unknown>) => SecurityPostureFinding[];

/** Feature-detect the rule on the installed `@objectstack/lint`. */
async function loadRule(): Promise<SecurityRule | null> {
  try {
    const mod: Record<string, unknown> = await import('@objectstack/lint');
    return typeof mod?.validateSecurityPosture === 'function'
      ? (mod.validateSecurityPosture as SecurityRule)
      : null;
  } catch {
    return null;
  }
}

/**
 * Run the security-posture rule over the pending OBJECT drafts and return the
 * blocking problems, keyed back to the draft that carries each one.
 *
 * Empty means "clean, or nothing to say" — an unavailable lint, an unreadable
 * draft and a genuinely clean package are deliberately indistinguishable here,
 * because all three must leave the publish path untouched.
 *
 * @param ruleOverride test seam — inject the rule instead of feature-detecting.
 */
export async function lintDraftSecurityPosture(
  client: {
    getDraft?: (type: string, name: string, opts?: Record<string, unknown>) => Promise<unknown>;
  },
  pending: PendingDraft[],
  ruleOverride?: SecurityRule | null,
): Promise<DraftSecurityProblem[]> {
  try {
    const rule = ruleOverride !== undefined ? ruleOverride : await loadRule();
    if (!rule) return [];

    const objects = pending.filter((d) => d.type === 'object');
    if (objects.length === 0) return [];

    // Read decorations do not reach the rule (objectui#8181). MEASURED: neither
    // `validateSecurityPosture` nor `validateCapabilityReferences` moves its
    // verdict on a decorated body today (control: an object with no
    // `sharingModel` fires `security-owd-unset` in both directions), so this is
    // defence in depth rather than a fix. It is here because the alternative is
    // leaving one more verbatim copy of the unwrap that omits the strip, which
    // is the shape objectui#8181 exists to end: the rule should read the
    // document the AUTHOR wrote, so a future rule that enumerates keys cannot
    // inherit the defect. The key list is the spec's, never a local copy; the
    // ADR-0010 protection envelope is not on it and survives.
    const unwrap = (raw: unknown): Record<string, unknown> | null => {
      const item = (raw as { item?: unknown })?.item ?? raw;
      return item && typeof item === 'object'
        ? (stripReadDecorations(item) as Record<string, unknown>)
        : null;
    };

    const bodies = await Promise.all(
      objects.map((d) =>
        client
          .getDraft?.(d.type, d.name, d.packageId ? { packageId: d.packageId } : undefined)
          .then(unwrap)
          .catch(() => null) ?? Promise.resolve(null),
      ),
    );

    // Index-aligned with `bodies`, so a finding's `objects[i]` path maps back
    // to the draft it came from. The rule reports positionally; carrying the
    // list is what lets the sheet say WHICH item to go fix.
    const present: Array<{ draft: PendingDraft; body: Record<string, unknown> }> = [];
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body) present.push({ draft: objects[i], body });
    }
    if (present.length === 0) return [];

    const findings = rule({ objects: present.map((p) => p.body) });
    return findings
      .filter((f) => f && f.severity === 'error')
      .map((f) => {
        // Prefer the positional path (`objects[3].sharingModel`); fall back to
        // matching the rule's `where` against the name when a rule words its
        // location differently.
        const idx = Number(/^objects\[(\d+)\]/.exec(f.path ?? '')?.[1] ?? NaN);
        const hit = Number.isInteger(idx)
          ? present[idx]
          : present.find((p) => typeof f.where === 'string' && f.where.includes(String(p.draft.name)));
        return {
          type: hit?.draft.type ?? 'object',
          name: hit?.draft.name ?? '',
          rule: f.rule,
          hint: f.hint ?? '',
          message: f.message ?? '',
        };
      })
      .filter((p) => p.name !== '');
  } catch {
    return []; // advisory — never break publish
  }
}
