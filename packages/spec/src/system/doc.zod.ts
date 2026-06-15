// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

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
export const DocSchema = lazySchema(() => z.object({
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
   * ⇒ sorts after ordered siblings, then alphabetically by label.
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
}));
export type Doc = z.infer<typeof DocSchema>;
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
