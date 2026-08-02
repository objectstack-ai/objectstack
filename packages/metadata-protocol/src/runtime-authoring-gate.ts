// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The RUNTIME authoring gate — the fourth door (#4463).
 *
 * ## What was open
 *
 * #4409/#4445 collected 26 author-time rules into one registry and made
 * `os validate`, `os build` and `os lint` run it by construction. All three are
 * CLI commands. Every runtime metadata write — Studio's designer, REST `/meta`
 * item CRUD, an MCP/AI agent authoring a flow — lands in
 * {@link ObjectStackProtocolImplementation.saveMetaItem}, which ran a per-type
 * Zod `safeParse` and stopped. None of the 26 rules ran there.
 *
 * The issue's measured example: a tenant saves an approval flow whose
 * `expression` approver is broken CEL (`record.owner ==`). `approver.value` is
 * a `z.string()`, so the schema is green; the row lands in `sys_metadata`,
 * `registerFlow` registers it, and the node fails at its entry the first time
 * the flow fires. `os lint` had rejected that exact body since #4409 — and a
 * Studio tenant has no `os lint`. `sys_metadata` overlay rows are not in the
 * CLI's config file at all, so there was no command they could have run.
 *
 * ## Shape (the #4463 ruling)
 *
 * ONE shared core, ONE runtime gate — not a gate per surface. This module is
 * that gate. It holds no rules: `@objectstack/lint/runtime` filters the same
 * `AUTHORING_RULES` array the CLI runs, and `authoring-rule-wiring.test.ts`
 * fails if this file ever names a rule itself.
 *
 * ## The four decisions it implements
 *
 * - **D1 — where the gate is.** `state: 'active'` only. A draft save is always
 *   let through: a draft is allowed to be half-finished, gating one would
 *   destroy the Studio editing loop, and a draft cannot execute. `active` IS
 *   the publish verb, the same verb `os build` gates.
 * - **D2 — shape mismatch.** The rules are `(stack) => findings`; a runtime
 *   write is one item. The core builds a per-write snapshot and evaluates
 *   differentially — see `runtime-gate.ts` in `@objectstack/lint`.
 * - **D3 — severity → HTTP.** Gating findings become the SAME 422
 *   `invalid_metadata`-shaped envelope the Zod failure already produces, so
 *   Studio needs no new protocol: `issues[]` with `rule` / `path` / `message` /
 *   `hint`. Advisory findings do not block (P2 puts them on the response).
 * - **D4 — escape hatch + migration.** The gate blocks NEW writes only; stored
 *   rows keep being read (the ADR-0087 asymmetry `applyConversionsToStoredItem`
 *   already proved right). `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades the
 *   refusal to a loud log for a migration window.
 */

import { runRuntimeAuthoringRules, type AuthoringFinding } from '@objectstack/lint/runtime';

/** The structured issue shape a 422 carries — D3's "reuse the Zod envelope". */
export interface RuntimeAuthoringIssue {
    /** Stable diagnostic rule id (`approval-expression-invalid`, …). */
    rule: string;
    /** Config path inside the submitted body. */
    path: string;
    /** Human-readable location (`flow "leave_approval" · node "approve"`). */
    where: string;
    /** What is wrong. */
    message: string;
    /** How to fix it. */
    hint: string;
    severity: 'error' | 'warning' | 'info';
}

/**
 * The escape hatch (#4463 D4).
 *
 * `OS_ALLOW_*` per Prime Directive #9 — deliberately ungrouped and ugly,
 * because it is an opt-OUT of a check that ships ON. Existing `sys_metadata`
 * rows written before this gate existed may violate a rule; re-saving one
 * during a migration must not be impossible. Setting it makes the violation
 * TOLERATED, never invisible: every refusal it converts is logged in full.
 */
function unlintedWritesAllowed(): boolean {
    return typeof process !== 'undefined' && process.env?.OS_ALLOW_UNLINTED_METADATA_WRITES === '1';
}

/** One warn per `type|name|rule` per process — Studio republishes the same body a lot. */
const _advisoryWarned = new Set<string>();

const toIssue = (f: AuthoringFinding): RuntimeAuthoringIssue => ({
    rule: f.rule,
    path: f.path,
    where: f.where,
    message: f.message,
    hint: f.hint,
    severity: f.severity,
});

/**
 * Judge an about-to-be-published metadata body and return the `Error` the
 * caller must throw, or `null` to allow the write.
 *
 * Returning the error rather than throwing it mirrors
 * {@link ObjectStackProtocolImplementation.assertLockAllowsWrite}: the caller
 * owns the audit trail and the throw site.
 *
 * @param args.state Lifecycle the body is being written into. Anything but
 *   `'active'` returns `null` immediately (D1).
 */
export function evaluateRuntimeAuthoringGate(args: {
    /** Singular metadata type (`flow`, …). */
    type: string;
    name: string;
    state: 'draft' | 'active';
    body: unknown;
    /** Live object declarations, the resolution universe for the rules. */
    objects?: readonly unknown[];
    /** ADR-0080 SDUI manifest when the host has one. */
    sduiManifest?: unknown;
}): Error | null {
    // D1 — drafts are never gated. Publishing one runs this same function.
    if (args.state !== 'active') return null;

    const result = runRuntimeAuthoringRules({
        type: args.type,
        item: args.body,
        context: { objects: args.objects ?? [] },
        ...(args.sduiManifest !== undefined ? { sduiManifest: args.sduiManifest } : {}),
    });

    // P1 gates on `error` only. Advisories are surfaced as a deduped log rather
    // than dropped — running a rule and discarding its verdict is the same
    // "declared ≠ enforced" shape this gate exists to close, one notch quieter.
    // Putting them on the response (and rendering them in Studio) is P2.
    for (const advisory of result.advisories) {
        const key = `${args.type}|${args.name}|${advisory.rule}|${advisory.path}`;
        if (_advisoryWarned.has(key)) continue;
        _advisoryWarned.add(key);
        console.warn(
            `[Protocol] authoring advisory on ${args.type}/${args.name}: `
            + `[${advisory.rule}] ${advisory.where} — ${advisory.message} (${advisory.hint})`,
        );
    }

    if (result.errors.length === 0) return null;

    const issues = result.errors.map(toIssue);
    const summary = issues
        .slice(0, 3)
        .map((i) => `${i.path || i.where || '<root>'}: [${i.rule}] ${i.message}`)
        .join('; ');
    const detail = summary + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '');

    if (unlintedWritesAllowed()) {
        // Loud by construction (#4463 acceptance): the operator who set the
        // hatch gets the whole refusal in the log, every time, un-deduped —
        // this is a migration window, not a supported steady state.
        console.warn(
            `[Protocol] OS_ALLOW_UNLINTED_METADATA_WRITES=1 — ALLOWING a publish of `
            + `${args.type}/${args.name} that ${issues.length} author-time gating rule(s) reject: ${detail}. `
            + `The rules that ran: ${result.rulesRun.join(', ')}. Unset the variable once the metadata is fixed; `
            + `the runtime will execute this body as published.`,
        );
        return null;
    }

    const err = new Error(
        `[invalid_metadata] ${args.type}/${args.name} failed author-time validation: ${detail}`,
    );
    (err as any).code = 'INVALID_METADATA';
    (err as any).status = 422;
    (err as any).issues = issues;
    // Which rules produced the verdict, so a caller can tell "clean" from
    // "nothing ran" without guessing (route 3 of the surface-ownership rules:
    // absence must be loud).
    (err as any).rulesRun = result.rulesRun;
    return err;
}
