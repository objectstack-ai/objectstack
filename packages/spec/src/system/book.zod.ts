// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { retiredKey } from '../shared/retired-key';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

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

/**
 * Book-level and group-level inline translation maps, retired in 17.0.0
 * (#4667, ADR-0049).
 *
 * The trap here was PROXIMITY, not plausibility. `doc.translations` — two files
 * over, the same shape, the same name — is read on every path that renders a
 * doc. So a book's own map reads as the same feature switched on one level up.
 * It never was: the tree endpoint and the portal render `label` / `description`
 * verbatim, and the generic bundle translator covers view / action / object /
 * app / dashboard / page only (`i18n-resolver.ts`). A localized book was parsed,
 * stored, round-tripped — and rendered in the authoring locale to every reader.
 *
 * Shared by both levels deliberately: an author who localized one almost
 * certainly localized the other, and splitting the wording would make the second
 * rejection read like a different problem.
 */
const BOOK_TRANSLATIONS_RETIRED =
  'Inline `translations` on a book (and on a book group) was removed in @objectstack/spec '
  + '17.0.0 (#4667, ADR-0049) — no resolver ever read it. The book tree endpoint and the '
  + 'docs portal render `label` / `description` verbatim in every locale, so a localized '
  + 'book shipped its authoring-locale strings to every reader. Delete the key. NOTE the '
  + 'near neighbour that DOES work: `doc.translations` is live and read on every doc render '
  + 'path — localize the docs themselves, and the portal picks the reader\'s locale up from '
  + 'there. '
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

export const BookGroupSchema = lazySchema(() =>
  z.object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'group key must be lowercase snake_case')
      .describe('Stable group key (used by overrides, deep links, explicit `doc.group`)'),
    label: z.string().describe('Section title — first-class, i18n-homed'),
    // TOMBSTONE, not a deletion: `BookGroupSchema` is a plain `z.object` with
    // no `.strict()`, so a bare delete would have zod silently STRIP the key —
    // replacing one silent no-op with another. `retiredKey` types it `never`
    // (a tsc error at the authoring site) and raises the prescription on parse.
    // Its liveness row therefore STAYS: the key is still in the walked shape.
    translations: retiredKey(BOOK_TRANSLATIONS_RETIRED),
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
  order?: number;
  include?: BookInclude;
  package?: string;
  pages?: BookNode[];
};

/**
 * Access audience for a book — a reference into the permission model
 * (ADR-0046 §6.7, vocabulary per ADR-0090). The gate is a capability
 * reference (a permission-set name), never a distribution one: books ship in
 * packages, and packages own permission sets but never positions (ADR-0090
 * D9) — a package gating its Admin Guide to its own `crm_admin` set keeps
 * provenance and uninstall semantics intact (ADR-0086).
 */
export const BookAudienceSchema = lazySchema(() =>
  z.union([
    z.literal('org'), // default — inherits the package grant (§3.6)
    z.literal('public'), // ≡ the built-in `guest` position (ADR-0090 D9): anonymous, indexable
    z.object({ permissionSet: z.string() }), // capability-gated, e.g. { permissionSet: 'crm_admin' }
  ]),
);
export type BookAudience = 'org' | 'public' | { permissionSet: string };

export const BookSchema = lazySchema(() =>
  strictObject({
    surface: 'this book',
    history:
      'Until #4001 closed this shape these were dropped silently — the book still '
      + 'registered, minus whatever the key was meant to configure.',
    aliases: {
      title: 'label', sections: 'groups', chapters: 'groups', toc: 'groups',
      access: 'audience', visibility: 'audience', sort: 'order', position: 'order',
      url: 'slug', path: 'slug',
      // `i18n: 'translations'` retired with the key it pointed at (#4667).
    },
    guidance: {
      translations: BOOK_TRANSLATIONS_RETIRED,
      i18n: BOOK_TRANSLATIONS_RETIRED,
    },
  }, {
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'name must be lowercase snake_case')
      .describe('Book name (namespace prefix recommended, like every metadata name)'),
    label: z.string().optional().describe('Display title'),
    description: z.string().optional(),
    // `translations` removed in 17.0.0 (#4667) — see BOOK_TRANSLATIONS_RETIRED.
    slug: z.string().optional().describe('Portal URL segment; defaults to name sans prefix'),
    icon: z.string().optional(),
    order: z.number().optional().describe('Orders books within the portal'),
    audience: BookAudienceSchema.optional().describe("Access audience; defaults to 'org' (inherits package grant)"),
    groups: z.array(BookGroupSchema).describe('The spine: ordered sections. Two levels total.'),

    // ADR-0010 — runtime protection envelope (internal — set by the loader).
    // `book` is a registered metadata type, so the artifact loader stamps
    // `_packageId` / `_provenance` on it like every sibling. Undeclared, they
    // were dropped on every parse — protection metadata lost on round-trip, and
    // a hard 422 waiting for the day this shape is closed.
    ...MetadataProtectionFields,
  }),
);

export type Book = {
  name: string;
  label?: string;
  description?: string;
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
  /** Tags for `include: { tag }` matching — `DocSchema.tags` (declared #4509). */
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

// ---------------------------------------------------------------------------
// Audience evaluation (ADR-0046 §6.7, vocabulary per ADR-0090) — pure helpers
// shared by the REST read layer so `/meta/book` and `/meta/doc` gate on ONE
// canonical semantics and can never drift from each other.
// ---------------------------------------------------------------------------

/** What the read layer knows about the caller when evaluating an audience. */
export interface AudienceCaller {
  /** True when the request carries an authenticated principal. */
  authenticated: boolean;
  /**
   * Names of the permission sets the caller effectively holds (positions
   * expanded, baseline included — the security plugin's resolution).
   * Absent/undefined means "unknown" and permission-set-gated audiences
   * DENY (fail closed, ADR-0049) — pass an empty array only when resolution
   * genuinely returned nothing.
   */
  permissionSets?: readonly string[];
}

/**
 * Whether a caller may read content published under `audience`:
 * `'public'` → always; `'org'` (or unset — §3.6 default) → any authenticated
 * principal; `{ permissionSet }` → an authenticated principal that holds the
 * named set. Unknown/unresolvable set holdings deny (fail closed).
 */
export function audienceAllows(audience: BookAudience | undefined, caller: AudienceCaller): boolean {
  if (isPublicAudience(audience)) return true;
  if (!caller.authenticated) return false;
  if (audience === undefined || audience === 'org') return true;
  if (typeof audience === 'object' && typeof audience.permissionSet === 'string') {
    return Array.isArray(caller.permissionSets) && caller.permissionSets.includes(audience.permissionSet);
  }
  return false; // unknown future shape → fail closed
}

/**
 * Doc names a book CLAIMS — members placed by a group rule (`include`),
 * an explicit `doc.group`, or a pinned `pages` override. Deliberately
 * EXCLUDES the synthetic *Uncategorized* orphan group: orphans are a
 * rendering convenience ("nothing is ever dropped" in the tree view), not
 * an authored membership claim, and letting them ride along would leak
 * every unclaimed doc of a package through any `public` book it ships.
 */
export function resolveBookClaimedDocs(book: Book, docs: ResolverDoc[], bookPackage?: string): Set<string> {
  const claimed = new Set<string>();
  for (const group of resolveBookTree(book, docs, bookPackage).groups) {
    if (group.key === UNCATEGORIZED_KEY) continue;
    for (const entry of group.entries) {
      if (entry.doc) claimed.add(entry.doc);
    }
  }
  return claimed;
}

/** A book plus the provenance the audience resolver needs. */
export interface AudienceBook extends Book {
  /** Owning package id (stamped `_packageId` by the metadata layer). */
  packageId?: string;
}

/**
 * Effective audience of every doc = the union over the books that claim it
 * (ADR-0046 §6.7). A doc claimed by no authored book falls back to `'org'` —
 * the §3.6 package-grant default (equivalently: the implicit per-package
 * book, §6.4, whose audience is `'org'`). Exposure is therefore always an
 * authored decision: nothing becomes `public` or permission-set-gated except
 * through a book that explicitly claims it.
 */
export function resolveDocAudiences(
  books: readonly AudienceBook[],
  docs: ResolverDoc[],
): Map<string, BookAudience[]> {
  const audiences = new Map<string, BookAudience[]>();
  for (const doc of docs) audiences.set(doc.name, []);
  for (const book of books) {
    const audience: BookAudience = book.audience ?? 'org';
    for (const name of resolveBookClaimedDocs(book, docs, book.packageId)) {
      audiences.get(name)?.push(audience);
    }
  }
  for (const [name, list] of audiences) {
    if (list.length === 0) audiences.set(name, ['org']);
  }
  return audiences;
}

/** Whether a caller may read a doc given its effective audiences (§6.7 union). */
export function docAudienceAllows(audiences: readonly BookAudience[] | undefined, caller: AudienceCaller): boolean {
  // A doc with no computed entry (not in the corpus handed to the resolver)
  // gets the same 'org' default as an unclaimed doc.
  if (!audiences || audiences.length === 0) return audienceAllows('org', caller);
  return audiences.some((a) => audienceAllows(a, caller));
}
