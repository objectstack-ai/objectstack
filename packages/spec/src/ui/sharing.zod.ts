// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module ui/sharing
 *
 * Sharing & Embedding Protocol
 *
 * Public-link sharing and iframe-embed configuration. The module name is
 * plural, but the two shapes below are in **opposite** postures, and #4001 批 14
 * measured why rather than assuming a file-level verdict:
 *
 * - `SharingConfigSchema` has a **live authoring door**. `FormViewSchema.sharing`
 *   carries it (`view.zod.ts`), `view` is a metadata-type root, and the runtime
 *   really reads it: `rest-server.ts` mounts the anonymous form endpoints only
 *   when `sharing.allowAnonymous === true` and a `sharing.publicLink` slug
 *   matches. Both example apps author it (`app-showcase` `inquiry.view.ts`,
 *   `app-crm` `lead.view.ts`). It is `strictObject` as of #4001 批 14.
 * - `EmbedConfigSchema` has **no door at all** — see its own block below.
 *
 * That split is the point. The ledger's classification question is *"who writes
 * this schema's input?"*, and it is answered per SCHEMA, not per file; before
 * 批 14 this file's row carried one verdict for both.
 */

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Shared history for the authorable shapes in this file (#4001).
 */
const SHARING_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the form still published, '
  + 'without whatever the key was meant to open up, gate or expire.';

/**
 * Sharing Config Schema
 *
 * Public sharing of a form view: a public link, optional password, domain
 * allow-list, expiry, and the anonymous-access switch the REST layer gates the
 * public form routes on.
 *
 * The aliases are semantic near-misses, not typos, and they matter more here
 * than the edit-distance fallback suggests: every declared key on this shape is
 * camelCase, and the fallback lower-cases the INPUT but not the candidates, so
 * each capital letter costs a point of budget it never recovers (#4990). A bare
 * `anonymous` therefore reaches nothing on its own.
 *
 * `allowAnonymous` is the one whose loss was silent AND security-shaped in both
 * directions: authored on the wrong spelling it was stripped, the form stayed
 * private, and the author believed it was public.
 */
export const SharingConfigSchema = lazySchema(() => strictObject({
  surface: 'this sharing config',
  history: SHARING_HISTORY,
  // Keys are matched case-insensitively with separators removed (`aliasProbe`),
  // so one entry covers `isPublic` / `is_public` / `IS-PUBLIC`.
  aliases: {
    // The switch. `public` / `isPublic` / `shared` are how the same intent is
    // spelled on neighbouring surfaces; `active` is the generic on/off word.
    public: 'enabled',
    isPublic: 'enabled',
    shared: 'enabled',
    active: 'enabled',
    // The slug/URL. Each of these is out of edit-distance reach of the
    // camelCase `publicLink`.
    url: 'publicLink',
    link: 'publicLink',
    shareUrl: 'publicLink',
    shareLink: 'publicLink',
    slug: 'publicLink',
    // Anonymous access — the key `rest-server.ts` actually gates the public
    // form routes on.
    anonymous: 'allowAnonymous',
    allowGuest: 'allowAnonymous',
    allowGuests: 'allowAnonymous',
    publicAccess: 'allowAnonymous',
    // Domain allow-list / expiry.
    domains: 'allowedDomains',
    allowedDomain: 'allowedDomains',
    emailDomains: 'allowedDomains',
    expires: 'expiresAt',
    expiry: 'expiresAt',
    expiration: 'expiresAt',
    validUntil: 'expiresAt',
  },
}, {
  enabled: z.boolean().default(false).describe('Enable public sharing'),
  publicLink: z.string().optional().describe('Generated public share URL'),
  password: z.string().optional().describe('Password required to access shared link'),
  allowedDomains: z.array(z.string()).optional()
    .describe('Restrict access to specific email domains (e.g. ["example.com"])'),
  expiresAt: z.string().optional()
    .describe('Expiration date/time in ISO 8601 format'),
  allowAnonymous: z.boolean().optional().default(false)
    .describe('Allow access without authentication'),
}));

/**
 * Embed Config Schema
 * Configuration for iframe embedding of an app, page, or form.
 * Supports origin restrictions, display options, and responsive sizing.
 *
 * ⛔ **DELIBERATELY NOT `strictObject` — this shape has NO AUTHORING DOOR**
 * (#4001 批 14, ADR-0078 completeness gate). Three independent measurements on
 * 2026-08-03, each with a positive control that passed in the same run:
 *
 * 1. **Carrier key** — nothing in `packages/spec/src` imports this schema except
 *    the `ui/index.ts` barrel. No metadata type declares an `embed` key; the one
 *    sibling in this file (`SharingConfigSchema`) is carried by
 *    `FormViewSchema.sharing`, and this one is carried by nothing.
 * 2. **Graph reachability** — BFS from the 24 metadata-type roots plus
 *    `defineStack`'s `ObjectStackSchema` (the closure `build-schemas.ts` uses for
 *    the #4650 deletion check) visits 6860 nodes and never reaches it. Controls
 *    `PageSchema` / `ActionSchema` / `DashboardWidgetSchema` / `WebhookSchema`
 *    were all `root-graph` in the same run, and injecting a synthetic carrier
 *    flipped this schema to `root-graph` — so "unreachable" is a fact about the
 *    graph, not a broken instrument.
 * 3. **Call sites** — no `.parse()` anywhere in framework or objectui outside
 *    this module's own `sharing.test.ts` and objectui's export-surface pin,
 *    which parses a literal it wrote itself.
 *
 * `.strict()` is a property of a PARSE, and nothing parses this. Closing it
 * would spend a v17 breaking change to make the file look finished and leave a
 * precisely-validated dead slot — *"the more convincing lie"* (#4583). The
 * verdict this shape actually needs is ADR-0049 enforce-or-remove; filed as #5015
 * and recorded in the strictness ledger's `no door` class.
 *
 * The pin in `sharing.test.ts` goes RED the moment anyone gives this shape a
 * carrier key — at which point it becomes authorable and this comment is wrong.
 */
export const EmbedConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable iframe embedding'),
  allowedOrigins: z.array(z.string()).optional()
    .describe('Allowed iframe parent origins (e.g. ["https://example.com"])'),
  width: z.string().optional().default('100%').describe('Embed width (CSS value)'),
  height: z.string().optional().default('600px').describe('Embed height (CSS value)'),
  showHeader: z.boolean().optional().default(true).describe('Show interface header in embed'),
  showNavigation: z.boolean().optional().default(false).describe('Show navigation in embed'),
  responsive: z.boolean().optional().default(true).describe('Enable responsive resizing'),
}));

// Type Exports
export type SharingConfig = z.infer<typeof SharingConfigSchema>;
export type EmbedConfig = z.infer<typeof EmbedConfigSchema>;
