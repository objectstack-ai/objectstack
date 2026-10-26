// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The install refusal `422 DEPENDENCY_MISSING` (ADR-0141 D2), in the author's
 * terms — 「请先安装 HotCRM 6.x」 — built from the refusal's own facts.
 *
 * The three install doors refuse a package whose declared `dependencies` the
 * environment does not satisfy with one envelope:
 *
 *   { code: 'DEPENDENCY_MISSING', message, details: { compatible: false, issues, unmet } }
 *
 * `issues` is one `dependency_missing` issue per unmet entry, its message in
 * the server's English; `unmet` carries the same entries as facts — the
 * declaring `packageId`, the `dependency`, the declared `range`, what was
 * `found` and the `installedVersion` when one is installed. The Console draws
 * one line per entry from those facts in the reader's locale, under one
 * heading, instead of the server's English sentence. ⛔ No rule of its own: a
 * `found` value this reader does not know draws nothing of its own, and the
 * envelope's message stands.
 */

import { useCallback } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import { errorCodeIs } from '@object-ui/types';

/** What the refusal says was found for one declared entry (`details.unmet[].found`). */
export type DependencyMissingFound =
  | 'absent'
  | 'out-of-range'
  | 'unreadable-range'
  | 'unreadable-version'
  | 'unreadable-declaration';

/** One unmet declared entry, as `details.unmet[]` carries it. */
export interface DependencyMissingFact {
  packageId: string;
  found: DependencyMissingFound;
  dependency?: string;
  range?: string;
  installedVersion?: string;
}

const LINE_KEY: Record<DependencyMissingFound, string> = {
  absent: 'marketplace.install.dependencyMissing.absent',
  'out-of-range': 'marketplace.install.dependencyMissing.outOfRange',
  'unreadable-range': 'marketplace.install.dependencyMissing.unreadableRange',
  'unreadable-version': 'marketplace.install.dependencyMissing.unreadableVersion',
  'unreadable-declaration': 'marketplace.install.dependencyMissing.unreadableDeclaration',
};

const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * The refusal's facts, or `null` when `details` carries none this reader can
 * draw — an older runtime, another refusal, or an entry with an unknown
 * `found`. All or nothing: a list that dropped an entry would tell the author
 * fewer things to install than the server refused for.
 */
export function readDependencyMissing(details: unknown): DependencyMissingFact[] | null {
  const unmet = (details as { unmet?: unknown } | null | undefined)?.unmet;
  if (!Array.isArray(unmet) || unmet.length === 0) return null;
  const facts: DependencyMissingFact[] = [];
  for (const entry of unmet) {
    const e = entry as Record<string, unknown> | null;
    if (!e || !isText(e.packageId) || typeof e.found !== 'string' || !(e.found in LINE_KEY)) return null;
    const found = e.found as DependencyMissingFound;
    if (found !== 'unreadable-declaration' && (!isText(e.dependency) || typeof e.range !== 'string')) return null;
    facts.push({
      packageId: e.packageId,
      found,
      ...(isText(e.dependency) ? { dependency: e.dependency } : {}),
      ...(typeof e.range === 'string' ? { range: e.range } : {}),
      ...(isText(e.installedVersion) ? { installedVersion: e.installedVersion } : {}),
    });
  }
  return facts;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The heading and one line per fact, newline-joined, in the translator's locale. */
export function dependencyMissingText(facts: readonly DependencyMissingFact[], t: Translate): string {
  const lines = facts.map((fact) => t(LINE_KEY[fact.found], {
    packageId: fact.packageId,
    dependency: fact.dependency ?? '',
    range: fact.range ?? '',
    installedVersion: fact.installedVersion ?? '—',
  }));
  return [t('marketplace.install.dependencyMissing.heading'), ...lines.map((line) => `• ${line}`)].join('\n');
}

/**
 * The text for a caught install error: the refusal drawn from its facts when
 * it is `DEPENDENCY_MISSING` and carries them (`err.details`), else `null` and
 * the caller keeps its own message.
 */
export function useDependencyMissingText(): (err: unknown) => string | null {
  const { t } = useObjectTranslation();
  return useCallback((err: unknown) => {
    if (!errorCodeIs(err, 'DEPENDENCY_MISSING')) return null;
    const facts = readDependencyMissing((err as { details?: unknown } | null | undefined)?.details);
    return facts ? dependencyMissingText(facts, t as Translate) : null;
  }, [t]);
}
