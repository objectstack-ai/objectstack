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
 * Identity model: `name` = filename stem and MUST carry the package
 * namespace prefix (`crm_lead_guide.md` → `crm_lead_guide`). Unlike object
 * names (validated in the kernel because they map to physical table
 * names), doc-name prefixing is a *logical* uniqueness requirement — the
 * metadata registry key carries no package coordinate — so it is enforced
 * by build/publish lint, not by this schema.
 *
 * Docs are inert data: the kernel registers them without parsing
 * `content`, and they participate in no runtime behavior. Renderers
 * resolve relative links between docs (`[guide](./crm_lead_guide.md)`)
 * by stripping `./` and `.md` to obtain the target doc name.
 */
export const DocSchema = lazySchema(() => z.object({
  /**
   * Unique doc name; equals the source filename stem. Namespace-prefixed
   * (e.g. `crm_lead_guide`) — see ADR-0046 §3.2 for the enforcement
   * posture (build/publish lint, not kernel rejection).
   */
  name: z.string()
    .regex(/^[a-z][a-z0-9_]*$/, 'name must be lowercase snake_case')
    .describe('Unique doc name (= filename stem, namespace-prefixed snake_case)'),

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
}));
export type Doc = z.infer<typeof DocSchema>;
