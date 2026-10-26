/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * approverIdentity — the ONE place the console turns an approver REFERENCE
 * into something a person can read (`77f846a8b`).
 *
 * ## The defect this closes
 *
 * `sys_approval_request.pending_approvers` carries the engine's own vocabulary:
 * `<kind>:<value>` references (`position:sales_manager`, `department:<id>`, …),
 * the portable indirect bindings ADR-0090 D3 leads with. The record page's
 * approval panel ran every entry through `formatIdentity`, which knew `role:`
 * and email addresses and otherwise MIDDLE-TRUNCATED anything over 14
 * characters. `position:sales_manager` is 22, so the one line answering *who is
 * holding this record* rendered as
 *
 *     positi…ager
 *
 * — an internal identifier, and not even a complete one. The same string
 * reached the admin-override confirm dialog un-truncated (`bypassedApproverNames`
 * defaults its formatter to identity), so a dialog that explains a subtle
 * governance concept in plain prose named the bypassed party as
 * `position:sales_manager`.
 *
 * ## What replaces it
 *
 * Three tiers, most authoritative first — the first that answers wins:
 *
 *   1. **The server's own resolution.** `pending_approver_names[ref]` is the
 *      producer's id -> name mapping. When it answers, nothing here fires and no
 *      request is made. This module never overrides it.
 *   2. **The directory record or the registry item.** A ref whose kind the
 *      spec declares as `source: 'data'` names a row in a system directory
 *      object ({@link APPROVER_DIRECTORY_BINDINGS}); its display column is the
 *      label a person recognizes (`sys_team.label` -> `Platform Team`). A ref
 *      whose kind the spec declares as `source: 'registry'` names a declared
 *      metadata item by its machine name ({@link APPROVER_REGISTRY_TYPES},
 *      objectui#7611 Q3b); the item's `label` is the readable name
 *      (`position` `sales_manager` -> `Sales Manager` / `销售经理`).
 *      `useApproverDirectory` fetches both; this module only composes them.
 *   3. **The machine name, prettified.** With no adapter and no directory row,
 *      `sales_manager` -> `Sales Manager` still beats `positi…ager`, and it is
 *      derived rather than guessed.
 *
 * The raw reference is never lost — every caller keeps it as the element's
 * `title`, which is where the card says an internal identifier belongs.
 *
 * ## Why staffing is tri-state, and why that is load-bearing
 *
 * "Nobody currently holds this position" is a REAL state and the motivating
 * rescue case for the admin-override path (framework#3424) — a request routed
 * to an unstaffed seat. `销售经理(暂无在岗人员)` is actionable; `positi…ager` is
 * not. But "the staffing query failed / was never run" is a different claim
 * from "the seat is empty", and rendering the first as the second would put a
 * fabricated fact on a governance surface. So {@link ResolvedApprover.holders}
 * is `undefined` (unknown — say nothing) / `[]` (probed, confirmed empty) /
 * a non-empty list, and {@link approverDisplay} only ever reports an empty seat
 * for the middle case. Same asymmetry, same reason, as `isViaOverrideRow` in
 * `approvalOverride.ts`.
 */

import { APPROVER_VALUE_SOURCES } from '@objectstack/spec/automation';
import { APPROVER_REGISTRY_TYPES } from './approverValueSources.js';

export { APPROVER_REGISTRY_TYPES };

/** A parsed `<kind>:<value>` approver reference. */
export interface ApproverRef {
  /** The reference exactly as the server sent it. */
  raw: string;
  /** Approver type (`position` / `team` / `department` / `user` / …). */
  kind: string;
  /** The value the kind's binding commits — a machine name or a row id. */
  value: string;
}

/** Where a directory-backed approver kind's row lives, and what to show for it. */
export interface ApproverDirectoryBinding {
  /** Directory object holding the row — from the spec's published binding. */
  object: string;
  /** Column the reference's value matches — from the spec's binding. */
  valueField: string;
  /**
   * Columns tried in order for the row's human label. PRESENTATION, and
   * deliberately local: `@objectstack/spec` publishes the data contract only
   * and says so (see `APPROVER_VALUE_SOURCES`'s own docstring), exactly as
   * `FlowReferenceField`'s `RECORD_LOOKUP_PRESENTATION` composes on top of the
   * same source. A list rather than one column because these rows come from
   * four different objects whose label column is not uniformly named, and a
   * missing label must degrade to the machine name rather than to blank.
   */
  displayFields: string[];
}

/**
 * PRESENTATION per directory object — see {@link ApproverDirectoryBinding.displayFields}.
 * Keyed by object so a kind whose spec binding moves objects picks the right
 * columns without a second edit here.
 */
const DISPLAY_FIELDS_BY_OBJECT: Record<string, string[]> = {
  sys_team: ['label', 'name'],
  sys_business_unit: ['label', 'name'],
  sys_user: ['full_name', 'name', 'display_name', 'email'],
};

/** Columns tried for a person's name (`sys_user` rows only). */
export const PERSON_DISPLAY_FIELDS: readonly string[] = DISPLAY_FIELDS_BY_OBJECT.sys_user;

/**
 * The approver kinds backed by DATA records, DERIVED from the spec.
 *
 * Never hand-written: framework#3508 is the measured cost of a local mirror of
 * this contract (every directory kind wired to the metadata registry, which
 * holds no `sys_position` ROWS — candidates came back empty and the control
 * degraded to free text). Reading `APPROVER_VALUE_SOURCES` means a new approver
 * type is covered here the day the spec publishes it, and a kind whose source
 * is `enum` / `auto` / `unsupported` is skipped rather than thrown on — a
 * module-level throw over a vocabulary change would white-screen the record page.
 */
export const APPROVER_DIRECTORY_BINDINGS: Record<string, ApproverDirectoryBinding> =
  Object.fromEntries(
    Object.entries(APPROVER_VALUE_SOURCES).flatMap(([kind, source]) => {
      if (!source || source.source !== 'data') return [];
      const object = String(source.object);
      return [[
        kind,
        {
          object,
          valueField: String(source.valueField),
          displayFields: DISPLAY_FIELDS_BY_OBJECT[object] ?? ['label', 'name'],
        },
      ]];
    }),
  );

/** Every approver kind the spec declares — directory-backed or not. */
const KNOWN_APPROVER_KINDS = new Set(Object.keys(APPROVER_VALUE_SOURCES));

/**
 * Does a `kind:` reference carry a machine NAME — prose to recover — rather
 * than an opaque row id?
 *
 * Read off the published binding, never off a list of kinds: a registry-bound
 * kind (objectui#7611 Q3b) names a declared item and has no id at all, and a
 * `data` kind commits a name exactly when its `valueField` is `name`. The
 * installed spec binds `position` to the registry (objectstack#22710), so it
 * answers through the first arm; the second arm reads a `data` binding the same
 * way, so a kind the spec moves is followed with no edit here.
 */
export function approverValueIsName(kind: string): boolean {
  return !!APPROVER_REGISTRY_TYPES[kind] || APPROVER_DIRECTORY_BINDINGS[kind]?.valueField === 'name';
}

/**
 * Can this console look a `kind:` reference up itself — in a directory object
 * (`data`) or in the metadata registry (`registry`)?
 */
export function approverKindIsResolvable(kind: string): boolean {
  return !!APPROVER_DIRECTORY_BINDINGS[kind] || !!APPROVER_REGISTRY_TYPES[kind];
}

/**
 * Split `<kind>:<value>` into its parts, or `null` when the string is not an
 * approver reference at all.
 *
 * Strict on the kind: only a prefix the SPEC declares counts. A bare user id, a
 * UUID, an email address (`a@b.com` has no colon) and a namespaced value from
 * some other subsystem must all fall through to the caller's existing
 * formatting rather than being re-read as an approver seat.
 */
export function parseApproverRef(raw: string | null | undefined): ApproverRef | null {
  if (!raw || typeof raw !== 'string') return null;
  const at = raw.indexOf(':');
  if (at <= 0 || at === raw.length - 1) return null;
  const kind = raw.slice(0, at);
  if (!KNOWN_APPROVER_KINDS.has(kind)) return null;
  return { raw, kind, value: raw.slice(at + 1) };
}

/**
 * `manager_review` -> "Manager Review"; `flow:qif_review` -> "QIF Review".
 *
 * Moved here from `RecordApprovalsPanel` so the panel, the override dialog and
 * the directory resolver cannot prettify a machine name three different ways.
 */
export function prettifyMachineName(raw: string | null | undefined): string {
  if (!raw) return '—';
  const base = String(raw).replace(/^flow:/, '').trim();
  return base.split(/[_\-\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '—';
}

/**
 * Render an actor/approver identifier in a friendly form (mirrors the Approval
 * Center): emails as-is, `role:<name>` labeled, a reference whose binding
 * commits a machine NAME ({@link approverValueIsName} — a directory `name`
 * column, or a registry item) prettified, and opaque 16+ char ids
 * middle-truncated.
 *
 * Moved here from `RecordApprovalsPanel` in `77f846a8b` so the panel, the
 * timeline and the admin-override dialog cannot format one identifier three
 * ways. The truncation arm is deliberately kept for the id-valued kinds: a raw
 * UUID wall is what objectui#3461 complained about, and a UUID has no prose to
 * recover. What `77f846a8b` adds is the arm above it — `position:sales_manager`
 * carries a machine name, so it never had to be truncated in the first place.
 */
export function formatIdentity(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.includes('@')) return id;
  if (id.startsWith('role:')) return `Role: ${id.slice(5)}`;
  const ref = parseApproverRef(id);
  if (ref && approverValueIsName(ref.kind)) {
    return prettifyMachineName(ref.value);
  }
  if (id.length > 14) return `${id.slice(0, 6)}…${id.slice(-4)}`;
  return id;
}

/**
 * The pending-approver references on `record` that the SERVER left unresolved
 * and that this console can look up itself.
 *
 * The gate that keeps `useApproverDirectory` inert on a backend that resolves
 * everything: an entry with a `pending_approver_names` answer is dropped here,
 * so it costs no request. Takes `unknown` because the two callers hold the row
 * at different types — the panel has an `ApprovalRequestLite`, the override
 * dialog the same untyped `record` `bypassedApproverNames` reads.
 */
export function unresolvedApproverRefs(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  const row = record as { pending_approvers?: unknown; pending_approver_names?: unknown };
  const pending = Array.isArray(row.pending_approvers) ? row.pending_approvers : [];
  const names =
    row.pending_approver_names && typeof row.pending_approver_names === 'object'
      ? (row.pending_approver_names as Record<string, unknown>)
      : {};
  const out: string[] = [];
  for (const raw of pending) {
    if (typeof raw !== 'string' || !raw) continue;
    const served = names[raw];
    if (typeof served === 'string' && served) continue;
    const ref = parseApproverRef(raw);
    if (!ref || !approverKindIsResolvable(ref.kind)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/** What the directory could tell us about ONE approver reference. */
export interface ResolvedApprover {
  /** The row's display label, absent when no row answered. */
  label?: string;
  /**
   * People filling the seat. TRI-STATE, and the distinction is the point:
   * `undefined` = never probed or the probe failed (say nothing), `[]` = probed
   * and the seat is genuinely empty, non-empty = the people. See this module's
   * docstring.
   */
  holders?: string[];
}

/** How one approver reference should read on screen. */
export interface ApproverDisplay {
  /** Primary identification — never a truncated raw id once the ref parses. */
  label: string;
  /** Secondary line: the people filling the seat. Empty when there is none. */
  detail: string;
  /** The reference verbatim, for `title` / debug surfaces. */
  raw: string;
  /** Probed AND empty — the actionable state, never an unknown rendered as one. */
  unstaffed: boolean;
}

/** The localized fragments {@link approverDisplay} needs, injected by the caller. */
export interface ApproverDisplayCopy {
  /** The surface's existing identity formatter, for refs that do not parse. */
  fallback: (id: string) => string;
  /** Joins holder names with the locale's list separator (`, ` / `、`). */
  joinNames: (names: string[]) => string;
  /** Wraps a seat that nobody currently holds (`销售经理(暂无在岗人员)`). */
  unstaffed: (seat: string) => string;
}

/** Holder names beyond this many collapse into a `+N` counter on the chip. */
export const MAX_INLINE_HOLDERS = 3;

/**
 * Compose the one string a person reads for one pending approver.
 *
 * `serverName` first (the producer resolved it — never second-guess that),
 * then the directory row's or registry item's label, then the prettified
 * machine name. Prettifying is restricted to references whose binding commits a
 * NAME ({@link approverValueIsName}): a position is referenced by machine name
 * because the engine routes by it, so `sales_manager` prettifies into real
 * prose. The id-valued kinds
 * (`user`/`team`/`department`) carry opaque row ids that prettify into
 * nonsense — those keep the caller's existing formatting, which is the right
 * treatment for an id and is not what `77f846a8b` fixes.
 */
export function approverDisplay(
  raw: string,
  opts: {
    serverName?: string | null;
    resolved?: ResolvedApprover;
    copy: ApproverDisplayCopy;
  },
): ApproverDisplay {
  const { serverName, resolved, copy } = opts;
  const ref = parseApproverRef(raw);

  const resolvedLabel = resolved?.label?.trim() || '';
  const serverLabel = typeof serverName === 'string' ? serverName.trim() : '';
  const derived = ref && approverValueIsName(ref.kind)
    ? prettifyMachineName(ref.value)
    : '';

  let label = serverLabel || resolvedLabel || derived || copy.fallback(raw);

  const holders = resolved?.holders;
  let detail = '';
  let unstaffed = false;
  if (Array.isArray(holders)) {
    if (holders.length === 0) {
      unstaffed = true;
      label = copy.unstaffed(label);
    } else {
      const shown = holders.slice(0, MAX_INLINE_HOLDERS);
      detail = copy.joinNames(shown);
      if (holders.length > shown.length) detail += ` +${holders.length - shown.length}`;
    }
  }

  return { label, detail, raw, unstaffed };
}

/** First non-empty display column of a directory row, or `''`. */
export function rowLabel(row: unknown, displayFields: readonly string[]): string {
  if (!row || typeof row !== 'object') return '';
  const r = row as Record<string, unknown>;
  for (const f of displayFields) {
    const v = r[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/**
 * The English copy, for a surface with no translator mounted — provider-less
 * embeds and unit tests. Mirrors the `en` pack values used as the inline
 * `defaultValue`s in {@link approverCopyFrom}; the two must be edited together.
 */
export const DEFAULT_NAME_SEPARATOR = ', ';

export const DEFAULT_APPROVER_COPY: ApproverDisplayCopy = {
  fallback: formatIdentity,
  joinNames: (names) => names.join(DEFAULT_NAME_SEPARATOR),
  unstaffed: (seat) => `${seat} (no current holder)`,
};

/** Minimal shape of i18next's `t` — injected so this module stays pure. */
export type ApproverTranslate = (key: string, opts?: Record<string, unknown>) => unknown;

/**
 * Build {@link ApproverDisplayCopy} from a translator.
 *
 * The two keys live here, spelled in FULL, rather than at each surface: the
 * panel and the override dialog must name an empty seat with the same sentence,
 * and a second copy of a string is how two surfaces drift. Both inline
 * `defaultValue`s mirror the `en` pack exactly — `check:i18n-keys` fails on a
 * call site whose default contradicts the pack (objectui#3810).
 *
 * `approverNameSeparator` is a translated PUNCTUATION key rather than
 * `Intl.ListFormat` on purpose. Measured on this tree: `Intl.ListFormat('zh',
 * { style: 'short', type: 'unit' }).format(['张伟','李娜'])` yields `张伟李娜` —
 * two names run together with no separator, which reads as ONE person's name.
 * A list of approvers is exactly where that failure is least acceptable.
 */
export function approverCopyFrom(
  t: ApproverTranslate,
  fallback: (id: string) => string = formatIdentity,
): ApproverDisplayCopy {
  // A translator that answers with anything but a non-empty string (no
  // provider mounted, a pack still loading) yields to the English default
  // rather than to the literal `"undefined"` a bare `String()` would print.
  const str = (out: unknown, fallbackText: string): string =>
    typeof out === 'string' && out ? out : fallbackText;
  const separator = str(
    t('approvalsInbox.approverNameSeparator', { defaultValue: ', ' }),
    DEFAULT_NAME_SEPARATOR,
  );
  return {
    fallback,
    joinNames: (names) => names.join(separator),
    unstaffed: (seat) =>
      str(
        t('approvalsInbox.approverUnstaffed', {
          defaultValue: '{{seat}} (no current holder)',
          seat,
        }),
        DEFAULT_APPROVER_COPY.unstaffed(seat),
      ),
  };
}
