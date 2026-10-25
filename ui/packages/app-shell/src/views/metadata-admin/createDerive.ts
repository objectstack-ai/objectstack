/**
 * createDerive — declarative live-derivation helpers for the generic
 * metadata create form.
 *
 * The goal is to keep "smart" UX behaviors (auto slug, plural label)
 * out of bespoke per-type pages. Instead, a small closed set of named
 * transforms is exposed; types pick which ones they want via the
 * registry's `createDerive` config.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { CreateDeriveRule } from './registry.js';

// ── Pure transforms ───────────────────────────────────────────────────

/**
 * Convert a human label into a snake_case identifier.
 *
 * Strategy: NFKD-normalise, lowercase, replace runs of non-alphanum
 * with `_`, trim, strip leading digit, clamp to 64 chars.
 *
 * Non-Latin scripts (CJK, Arabic, …) leave the result empty — the
 * caller surface is expected to detect that and prompt the user to
 * enter `name` manually rather than silently writing garbage.
 */
export function slugify(input: string): string {
  if (typeof input !== 'string') return '';
  const normalised = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let out = normalised
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (/^\d/.test(out)) out = `n_${out}`;
  if (out.length > 64) out = out.slice(0, 64).replace(/_+$/g, '');
  return out;
}

/**
 * Naive English pluraliser. Handles -y → -ies, sibilants → -es, else
 * appends -s. Returns input unchanged when it contains no ASCII
 * letters (CJK passes through).
 */
export function naivePlural(input: string): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (!/[A-Za-z]/.test(trimmed)) return trimmed;
  // Already plural? Cheap heuristic — avoid double-pluralising.
  if (/(s|ses|xes|zes|ches|shes|ies)$/i.test(trimmed)) return trimmed;
  if (/[^aeiou]y$/i.test(trimmed)) return trimmed.replace(/y$/i, 'ies');
  if (/(s|x|z|ch|sh)$/i.test(trimmed)) return `${trimmed}es`;
  return `${trimmed}s`;
}

/**
 * snake_case / kebab-case → "Title Case".
 */
export function titlecase(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Take everything up to the first space / underscore / dash.
 */
export function firstToken(input: string): string {
  if (typeof input !== 'string') return '';
  const m = input.trim().match(/^[^\s_-]+/);
  return m ? m[0] : '';
}

export function applyTransform(
  transform: CreateDeriveRule['transform'],
  value: unknown,
): string {
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  switch (transform) {
    case 'slugify':
      return slugify(str);
    case 'plural-en':
      return naivePlural(str);
    case 'titlecase':
      return titlecase(str);
    case 'first-token':
      return firstToken(str);
    default:
      return str;
  }
}

// ── React hook ────────────────────────────────────────────────────────

export interface UseCreateDeriveArgs<T extends Record<string, unknown>> {
  /** Rules from `MetadataResourceConfig.createDerive` (may be undefined). */
  rules: readonly CreateDeriveRule[] | undefined;
  /** Current draft object. */
  draft: T;
  /** Setter — receives a partial patch to merge. */
  onPatch: (patch: Partial<T>) => void;
  /** When true, suspend derivation entirely (e.g. not in create mode). */
  enabled?: boolean;
}

export interface UseCreateDeriveResult {
  /**
   * Mark a target field as user-touched so future derivations leave it
   * alone. Call from input `onChange` handlers in the create form.
   */
  markTouched: (path: string) => void;
  /** Read-only set of currently touched target paths. */
  touched: ReadonlySet<string>;
}

/**
 * Watches `draft[from]` and writes derived values into `draft[to]`.
 *
 * Why a hook (not inline state machine in ResourceEditPage):
 *  - The "stop when user edits target" behavior needs persistent
 *    touched-set state across renders.
 *  - Multiple rules may target the same field; the hook resolves them
 *    deterministically in registry order.
 *  - Keeping the logic here lets us unit-test the derivation without
 *    spinning up the whole edit page.
 */
export function useCreateDerive<T extends Record<string, unknown>>(
  args: UseCreateDeriveArgs<T>,
): UseCreateDeriveResult {
  const { rules, draft, onPatch, enabled = true } = args;
  // Targets the user has typed into directly. Once a target appears
  // here, no rule will overwrite it again for the lifetime of the
  // create form (the form unmounts on submit, so this naturally resets).
  const touchedRef = useRef<Set<string>>(new Set());
  // Snapshot of `from` values from the prior render — lets us detect
  // *changes* and avoid re-firing on every keystroke unrelated to a
  // given source field.
  const prevFromRef = useRef<Record<string, unknown>>({});

  const markTouched = useCallback((path: string) => {
    touchedRef.current.add(path);
  }, []);

  useEffect(() => {
    if (!enabled || !rules || rules.length === 0) return;
    const patch: Record<string, unknown> = {};
    const prev = prevFromRef.current;
    const nextSnapshot: Record<string, unknown> = {};

    for (const rule of rules) {
      const fromVal = draft[rule.from];
      nextSnapshot[rule.from] = fromVal;
      const fromChanged = !Object.is(prev[rule.from], fromVal);
      if (!fromChanged) continue;
      const respectTouched = rule.untilUserEdits !== false;
      if (respectTouched && touchedRef.current.has(rule.to)) continue;
      // Don't fight other rules in the same batch.
      if (rule.to in patch) continue;
      const derived = applyTransform(rule.transform, fromVal);
      // Empty derivations (e.g. CJK → slugify) just clear the target;
      // that's intentional — the UI then knows to prompt for manual entry.
      if (draft[rule.to] !== derived) {
        patch[rule.to] = derived;
      }
    }

    prevFromRef.current = { ...prev, ...nextSnapshot };

    if (Object.keys(patch).length > 0) {
      onPatch(patch as Partial<T>);
    }
    // We deliberately depend on `draft` (referential) rather than every
    // rule.from — the rules array is treated as stable across the
    // lifetime of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, enabled]);

  return { markTouched, touched: touchedRef.current };
}

// ── Default field selection ───────────────────────────────────────────

/**
 * When a type doesn't declare `createFields`, fall back to a sensible
 * default: every required field, plus `name` and `label` if present.
 *
 * Returns a stable, order-preserving array (required first in their
 * schema order, then `name`/`label` if not already included).
 */
export function deriveDefaultCreateFields(
  schemaProperties: Record<string, unknown> | undefined,
  required: readonly string[] | undefined,
): string[] {
  const propKeys = schemaProperties ? Object.keys(schemaProperties) : [];
  const result: string[] = [];
  const push = (k: string) => {
    if (!result.includes(k) && propKeys.includes(k)) result.push(k);
  };
  // 1. Required fields, in JSONSchema order.
  for (const k of propKeys) {
    if (required?.includes(k)) push(k);
  }
  // 2. Then label/pluralLabel/name if not already in.
  for (const k of ['label', 'pluralLabel', 'name', 'description']) push(k);
  return result;
}
