// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package Documentation Metadata Protocol (ADR-0046)
 *
 * One `doc` item per Markdown file under the package's flat `src/docs/`
 * directory (no subdirectories — flatness is the contract that keeps
 * cross-references stable). The CLI compiles each file into this shape at
 * build time; TS-first stacks may also declare items inline via
 * `defineStack({ docs: [...] })`.
 *
 * Identity model: `name` = filename stem (lowercase snake_case). A namespace
 * prefix (`crm_lead_guide`) is a *recommended convention*, no longer required:
 * per ADR-0048, single-doc resolution is package-scoped (`getItem('doc', name,
 * packageId)` via `?package=` on the detail route), so two packages may ship a
 * doc with the same bare name and each resolves within its own package — just
 * like `page`/`dashboard`/`report`. The prefix stays useful for readable,
 * globally-unique filenames but is not load-bearing for uniqueness.
 *
 * Docs are inert data: the kernel registers them without parsing
 * `content`, and they participate in no runtime behavior. Renderers
 * resolve relative links between docs (`[guide](./crm_lead_guide.md)`)
 * by stripping `./` and `.md` to obtain the target doc name.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

export const DocSchema = lazySchema(() => strictObject({
  surface: 'this doc',
  history:
    'Until this shape was closed, these were dropped silently — the doc still registered, just without '
    + 'whatever the key was meant to configure.',
  aliases: {
    title: 'label',
    heading: 'label',
    body: 'content',
    markdown: 'content',
    md: 'content',
    text: 'content',
    summary: 'description',
    sort: 'order',
    sortorder: 'order',
    position: 'order',
    category: 'group',
    section: 'group',
    i18n: 'translations',
    locales: 'translations',
  },
  guidance: {
    path:
      '`path` is not a doc key. A doc\'s identity is its `name` (the source filename stem) — '
      + 'ADR-0046 keeps `src/docs/` flat precisely so there is no path to record.',
    slug: '`slug` is not a doc key. Use `name`; it is the filename stem and the resolution key.',
  },
}, {
  /**
   * Doc name; equals the source filename stem. Lowercase snake_case. A
   * namespace prefix (e.g. `crm_lead_guide`) is recommended for readable,
   * globally-unique filenames but NOT required — single-doc resolution is
   * package-scoped (ADR-0048), so bare names are unique within their package.
   */
  name: z.string()
    .regex(/^[a-z][a-z0-9_]*$/, 'name must be lowercase snake_case')
    .describe('Doc name (= filename stem, snake_case; namespace prefix recommended, not required)'),

  /**
   * Display title. The CLI derives it from frontmatter `title:` or the
   * first `#` heading; renderers fall back to `name` when absent.
   */
  label: z.string().optional()
    .describe('Display title; defaults to the first `#` heading, then the name'),

  /**
   * One-line summary for listings (the docs portal renders it under the
   * title). The CLI reads it from frontmatter `description:`. Optional and
   * short by convention — it travels in the list response (unlike
   * `content`, which the REST list omits by default), so a portal can show
   * summaries without fetching each doc's body.
   */
  description: z.string().optional()
    .describe('One-line summary for listings; from frontmatter `description:`'),

  /**
   * Raw Markdown body (CommonMark + GFM), frontmatter stripped.
   * MDX and image references are banned in v1 (ADR-0046 §3.4) —
   * enforced by lint, not here: the kernel load path must stay
   * content-agnostic.
   */
  content: z.string().describe('Raw Markdown content (CommonMark + GFM)'),

  /**
   * Optional sort key within a book group (ADR-0046 §6.2.1). A scalar, so it
   * three-way-merges cleanly under overlay — unlike a central nav array. Absent
   * ⇒ treated as 0 by the resolver (sorts among 0-keyed siblings), then
   * alphabetically by label.
   */
  order: z.number().optional().describe('Sort key within a book group (ADR-0046 §6)'),

  /**
   * Optional explicit placement: the `key` of the `book` group this doc belongs
   * to, used only when no group `include` rule expresses the membership.
   * Naming-by-convention (`crm_guide_*` caught by `include: "crm_guide_*"`)
   * usually makes this unnecessary.
   */
  group: z.string().optional().describe('Explicit book-group key (ADR-0046 §6); rules usually suffice'),

  /**
   * Membership tags — the operand of a book group's `include: { tag: '<t>' }`
   * rule (ADR-0046 §5).
   *
   * The tag half of `include` has always been implemented on the resolver side
   * (`matchesInclude` in `book.zod.ts` compares against these) and the REST book
   * route has always forwarded the value, but this schema is `.strict()` and did
   * not declare the key — so authoring `tags:` on a doc was a parse error, every
   * doc reached the resolver with `tags === undefined`, and `include: { tag }`
   * could never match anything. Declared here in 17.0.0 (#4509, ADR-0049): the
   * consumer already existed, so this is the enforce half of enforce-or-remove.
   *
   * Prefer a name convention (`include: "crm_guide_*"`) when one exists — tags
   * are for membership that cuts across naming, e.g. a `tutorial` tag spanning
   * several feature prefixes.
   */
  tags: z.array(z.string()).optional()
    .describe('Membership tags matched by a book group\'s `include: { tag }` rule (ADR-0046 §5)'),

  /**
   * Per-locale content variants (ADR-0046 i18n addendum). Compiled from
   * sibling `<name>.<locale>.md` files; the base `<name>.md` is the default
   * and the fallback. The REST layer resolves the request locale, returns a
   * single collapsed body, and strips this map — so consumers never see it.
   * Inert like the rest of the doc: the kernel stores it without parsing.
   */
  translations: z
    .record(
      z.string(),
      z.object({
        label: z.string().optional(),
        description: z.string().optional(),
        content: z.string(),
      }),
    )
    .optional()
    .describe('Per-locale {label?,description?,content} variants; the base doc is the fallback'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // See the note on `SeedSchema`: every registered metadata type gets stamped by
  // `MetadataPlugin`'s artifact loader, and an undeclared envelope is stripped
  // on every parse — the inverse drift that made `permission` 422 when it went
  // strict (#4001 findings log, entry 2).
  ...MetadataProtectionFields,
}));
export type Doc = z.input<typeof DocSchema>;
export type DocTranslation = NonNullable<Doc['translations']>[string];

/**
 * Collapse a doc to a single locale (ADR-0046 i18n). Returns a copy with
 * `label`/`description`/`content` swapped to the best-matching variant and the
 * `translations` map removed. Match order: exact locale -> primary subtag
 * (`zh-CN` -> `zh`) -> base doc. Per-field fallback: a variant that omits
 * `label`/`description` inherits the base value. A nullish/empty `locale`, or
 * no matching variant, yields the base doc (still minus `translations`).
 */
export function resolveDocLocale(doc: Doc, locale?: string | null): Doc {
  const { translations, ...base } = doc;
  if (!translations || !locale) return base as Doc;
  const want = String(locale);
  const variant = translations[want] ?? translations[want.split('-')[0]];
  if (!variant) return base as Doc;
  return {
    ...base,
    label: variant.label ?? base.label,
    description: variant.description ?? base.description,
    content: variant.content,
  } as Doc;
}
