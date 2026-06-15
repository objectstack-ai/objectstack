// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Package Documentation Navigation — the `book` element (ADR-0046 §6).
 *
 * A `book` is the **spine** of a table of contents: an ordered set of groups
 * (sections) plus identity and access. It deliberately does NOT store its
 * members. Membership — which doc sits in which group — is **derived** from a
 * rule on each group (`include` glob/tag) plus an optional per-doc
 * `order`/`group`, never held in a central array.
 *
 * Why a spine and not a container (ADR-0046 §6.2.1): storing the whole tree in
 * one array conflates low-cardinality group definitions (curated by a human,
 * rarely changed) with high-cardinality membership (churned by the AI on every
 * new doc). A central array forces a read-modify-write on every doc the AI
 * adds — stale/concurrent edits silently drop or reorder siblings — and breaks
 * overlay (RFC 7396 replaces arrays atomically, shadowing docs a later package
 * version adds). A derived spine removes the write entirely: the AI creates a
 * doc named to match a rule and it files itself (create-and-forget), and the
 * only per-doc storage is the scalar `doc.order`, which merges cleanly.
 */

/** A node inside an explicit `pages` override (the curated-order escape hatch). */
export const BookNodeSchema = lazySchema(() =>
  z.union([
    z.string(), // a doc name, or the literals '---' / '...'
    z.object({
      doc: z.string().optional().describe('Doc name to reference'),
      href: z.string().optional().describe('External link (use instead of `doc`)'),
      label: z.string().optional().describe('Optional label override; title authority stays in the doc'),
      badge: z.string().optional().describe('e.g. "beta" | "new"'),
      icon: z.string().optional(),
    }),
  ]),
);
export type BookNode =
  | string
  | { doc?: string; href?: string; label?: string; badge?: string; icon?: string };

/** Rule that derives a group's membership without storing it. */
export const BookIncludeSchema = lazySchema(() =>
  z.union([
    z.string().describe('Glob over doc names, e.g. "crm_guide_*"'),
    z.object({ tag: z.string() }).describe('Match by doc tag (§5 vocabulary)'),
  ]),
);
export type BookInclude = string | { tag: string };

export const BookGroupSchema = lazySchema(() =>
  z.object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'group key must be lowercase snake_case')
      .describe('Stable group key (used by overrides, deep links, explicit `doc.group`)'),
    label: z.string().describe('Section title — first-class, i18n-homed'),
    translations: z
      .record(z.string(), z.object({ label: z.string() }))
      .optional()
      .describe('Per-locale label variants'),
    order: z.number().optional().describe('Order of THIS group within the book'),
    include: BookIncludeSchema.optional().describe('Rule that derives membership (glob or tag)'),
    package: z
      .string()
      .optional()
      .describe('Scope the rule to a package id (default: the book package; cross-package via ADR-0048)'),
    pages: z
      .array(BookNodeSchema)
      .optional()
      .describe('OPTIONAL explicit override — hand-pin a curated order; wins over `include`'),
  }),
);
export type BookGroup = {
  key: string;
  label: string;
  translations?: Record<string, { label: string }>;
  order?: number;
  include?: BookInclude;
  package?: string;
  pages?: BookNode[];
};

/** Access audience for a book — a reference into the permission model (ADR-0046 §6.7). */
export const BookAudienceSchema = lazySchema(() =>
  z.union([
    z.literal('org'), // default — inherits the package grant (§3.6)
    z.literal('public'), // ≡ the data-layer `guest` profile (anonymous, indexable)
    z.object({ profile: z.string() }), // role-gated, e.g. { profile: 'admin' }
  ]),
);
export type BookAudience = 'org' | 'public' | { profile: string };

export const BookSchema = lazySchema(() =>
  z.object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'name must be lowercase snake_case')
      .describe('Book name (namespace prefix recommended, like every metadata name)'),
    label: z.string().optional().describe('Display title'),
    description: z.string().optional(),
    translations: z
      .record(z.string(), z.object({ label: z.string().optional(), description: z.string().optional() }))
      .optional(),
    slug: z.string().optional().describe('Portal URL segment; defaults to name sans prefix'),
    icon: z.string().optional(),
    order: z.number().optional().describe('Orders books within the portal'),
    audience: BookAudienceSchema.optional().describe("Access audience; defaults to 'org' (inherits package grant)"),
    groups: z.array(BookGroupSchema).describe('The spine: ordered sections. Two levels total.'),
  }),
);

export type Book = {
  name: string;
  label?: string;
  description?: string;
  translations?: Record<string, { label?: string; description?: string }>;
  slug?: string;
  icon?: string;
  order?: number;
  audience?: BookAudience;
  groups: BookGroup[];
};

/** Typed authoring helper, mirroring the other `define*` helpers. */
export function defineBook(book: Book): Book {
  return book;
}

// ---------------------------------------------------------------------------
// Derived-membership resolver (ADR-0046 §6.2.1) — the heart of the design.
// Pure function: given a book spine and the docs that exist *now*, produce the
// rendered tree. Membership is computed, never read from storage, so a doc a
// package adds appears immediately and no central array can shadow it.
// ---------------------------------------------------------------------------

/** Minimal doc header the resolver needs (a subset of `Doc` + provenance/order). */
export interface ResolverDoc {
  name: string;
  label?: string;
  description?: string;
  order?: number;
  /** Explicit placement: the `key` of the group this doc belongs to. */
  group?: string;
  /** Tags for `include: { tag }` matching (P3d; absent today). */
  tags?: string[];
  /** Owning package id (stamped as `_packageId`); used to scope `include`. */
  packageId?: string;
}

export interface ResolvedEntry {
  /** Doc name, or undefined for an external link / separator. */
  doc?: string;
  href?: string;
  label?: string;
  description?: string;
  badge?: string;
  icon?: string;
  /** True for a `---` separator node. */
  separator?: boolean;
}

export interface ResolvedGroup {
  key: string;
  label: string;
  entries: ResolvedEntry[];
}

export interface ResolvedBook {
  name: string;
  label?: string;
  groups: ResolvedGroup[];
}

const UNCATEGORIZED_KEY = 'uncategorized';

/** Compile a `*`-glob over doc names to a RegExp anchored on the whole name. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesInclude(doc: ResolverDoc, include: BookInclude, scopePackage?: string): boolean {
  if (scopePackage && doc.packageId && doc.packageId !== scopePackage) return false;
  if (typeof include === 'string') return globToRegExp(include).test(doc.name);
  return Array.isArray(doc.tags) && doc.tags.includes(include.tag);
}

function byOrderThenLabel(a: ResolverDoc, b: ResolverDoc): number {
  return (a.order ?? 0) - (b.order ?? 0) || (a.label ?? a.name).localeCompare(b.label ?? b.name);
}

function entryFromDoc(doc: ResolverDoc): ResolvedEntry {
  return { doc: doc.name, label: doc.label, description: doc.description };
}

/**
 * Resolve a book spine against the current doc set into a rendered tree.
 *
 * Rules (ADR-0046 §6.2.1):
 *  - A group with explicit `pages` uses that order verbatim; `'---'` is a
 *    separator and `'...'` expands to this group's rest (docs matched by the
 *    group's `include`/explicit-`group` but not named, then by order).
 *  - Otherwise membership is derived: a doc joins the first group (in group
 *    order) whose `include` matches it OR whose `key` equals the doc's explicit
 *    `group`. Within a group, docs sort by `doc.order` then label.
 *  - Any doc claimed by no group falls into a synthetic *Uncategorized* group
 *    appended last — nothing is ever dropped.
 */
export function resolveBookTree(book: Book, docs: ResolverDoc[], bookPackage?: string): ResolvedBook {
  const groupsSorted = [...book.groups]
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.order ?? 0) - (b.g.order ?? 0) || a.i - b.i)
    .map((x) => x.g);

  const claimed = new Set<string>();
  const byName = new Map(docs.map((d) => [d.name, d] as const));

  // First pass: rule/explicit membership for groups WITHOUT an explicit `pages`
  // override, so a `...` in an override group can later draw from its own rest.
  const derivedMembers = new Map<string, ResolverDoc[]>();
  for (const group of groupsSorted) {
    if (group.pages) continue;
    const scope = group.package ?? bookPackage;
    const members = docs.filter((d) => {
      if (claimed.has(d.name)) return false;
      return (
        (group.include != null && matchesInclude(d, group.include, scope)) ||
        (d.group != null && d.group === group.key)
      );
    });
    members.sort(byOrderThenLabel);
    members.forEach((d) => claimed.add(d.name));
    derivedMembers.set(group.key, members);
  }

  const resolvedGroups: ResolvedGroup[] = [];
  for (const group of groupsSorted) {
    let entries: ResolvedEntry[];
    if (group.pages) {
      const scope = group.package ?? bookPackage;
      entries = [];
      const pinned = new Set(
        group.pages.filter((n): n is string => typeof n === 'string' && n !== '...' && n !== '---'),
      );
      for (const node of group.pages) {
        if (node === '---') {
          entries.push({ separator: true });
        } else if (node === '...') {
          const rest = docs.filter(
            (d) =>
              !claimed.has(d.name) &&
              !pinned.has(d.name) &&
              ((group.include != null && matchesInclude(d, group.include, scope)) ||
                (d.group != null && d.group === group.key)),
          );
          rest.sort(byOrderThenLabel);
          rest.forEach((d) => {
            claimed.add(d.name);
            entries.push(entryFromDoc(d));
          });
        } else if (typeof node === 'string') {
          const d = byName.get(node);
          claimed.add(node);
          entries.push(d ? entryFromDoc(d) : { doc: node }); // missing doc → renderer shows "not found"
        } else if (node.doc) {
          const d = byName.get(node.doc);
          claimed.add(node.doc);
          entries.push({
            ...(d ? entryFromDoc(d) : { doc: node.doc }),
            label: node.label ?? d?.label,
            badge: node.badge,
            icon: node.icon,
          });
        } else if (node.href) {
          entries.push({ href: node.href, label: node.label, badge: node.badge, icon: node.icon });
        }
      }
    } else {
      entries = (derivedMembers.get(group.key) ?? []).map(entryFromDoc);
    }
    resolvedGroups.push({ key: group.key, label: group.label, entries });
  }

  // Orphans: docs claimed by no group.
  const orphans = docs.filter((d) => !claimed.has(d.name)).sort(byOrderThenLabel);
  if (orphans.length) {
    resolvedGroups.push({
      key: UNCATEGORIZED_KEY,
      label: 'Uncategorized',
      entries: orphans.map(entryFromDoc),
    });
  }

  return { name: book.name, label: book.label, groups: resolvedGroups };
}

/**
 * Synthesize the implicit per-package book (ADR-0046 §6.4): no authored book ⇒
 * one book keyed by the package id, a single group including every doc. The
 * model has no "flat vs book" fork — "flat" is just this synthetic book.
 */
export function deriveImplicitPackageBook(packageId: string, label?: string): Book {
  return {
    name: packageId,
    label: label ?? packageId,
    audience: 'org',
    groups: [{ key: 'all', label: label ?? 'Documentation', include: '*', package: packageId }],
  };
}

/** Whether a book is anonymously readable (ADR-0046 §6.7). */
export function isPublicAudience(audience?: BookAudience): boolean {
  return audience === 'public';
}
