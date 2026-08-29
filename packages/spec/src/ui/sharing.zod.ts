// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module ui/sharing
 *
 * Sharing & Embedding Protocol
 *
 * Public-link sharing of a form view. The module name is plural for historical
 * reasons: it once held two shapes in **opposite** postures, and #4001 批 14
 * measured them per SCHEMA rather than assuming a file-level verdict —
 * `SharingConfigSchema` a live authoring door, `EmbedConfigSchema` no door at
 * all. That measurement is what let the two be disposed of separately, and the
 * asymmetry survives as the reason this file reads the way it does:
 *
 * - `SharingConfigSchema` has a **live authoring door**. `FormViewSchema.sharing`
 *   carries it (`view.zod.ts`), `view` is a metadata-type root, and the runtime
 *   really reads it: `rest-server.ts` mounts the anonymous form endpoints only
 *   when `sharing.allowAnonymous === true` and a `sharing.publicLink` slug
 *   matches. Both example apps author it (`app-showcase` `inquiry.view.ts`,
 *   `app-crm` `lead.view.ts`). It is `strictObject` as of #4001 批 14.
 * - `EmbedConfigSchema` was **REMOVED** at #5015 (ADR-0049 enforce-or-remove) —
 *   see the block below where it stood.
 *
 * The ledger's classification question is *"who writes this schema's input?"*,
 * and it is answered per SCHEMA, not per file; before 批 14 this file's row
 * carried one verdict for both, and a file-level verdict would have been wrong
 * in one direction or the other whichever way it fell.
 */

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Shared history for the authorable shapes in this file (#4001).
 */
const SHARING_HISTORY =
  'Until this shape was closed these were dropped silently — the form still published, '
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

// [#5015] `EmbedConfigSchema` / `EmbedConfig` were REMOVED per ADR-0049
// enforce-or-remove, ruled REMOVE on 2026-08-04.
//
// The shape described iframe embedding of an app, page or form — `enabled`,
// `allowedOrigins`, `width` / `height`, `showHeader` / `showNavigation`,
// `responsive` — and **nothing in the repo so much as named it**. #4001 批 14
// measured it three ways on 2026-08-03 with positive controls; this retirement
// re-ran all three against `origin/main` first:
//
//   1. **Carrier key** — this module's only importers were the `ui/index.ts`
//      barrel and `ui/view.zod.ts`, and `view.zod.ts` names
//      `SharingConfigSchema` specifically. No schema anywhere declared an
//      `embed` key of this type. (Specifier RESOLUTION, not substring matching:
//      the repo holds two `sharing.zod` modules, and a substring test miscredits
//      `stack.zod.ts` / `security/index.ts` as importers of this one.)
//   2. **Graph reachability** — BFS from the 24 metadata-type roots plus
//      `defineStack`'s `ObjectStackSchema` never reached it, while
//      `SharingConfigSchema` — its own sibling in this file — resolved
//      `root-graph` in the same run alongside `Page` / `Action` /
//      `DashboardWidget` / `Webhook`, and a synthetic carrier flipped it.
//   3. **Call sites** — zero `.parse()` in objectstack, cloud or objectui
//      outside this module's own unit test.
//
// Why it was an orphan is worth recording, because it explains the asymmetry
// this file kept: the key that would have carried it, `App.embed`, was itself
// retired in 17.0.0 (2026-06 liveness audit / ADR-0049 — no iframe route ever
// read it) and survives one file over as a `retiredKey()` tombstone in
// `app.zod.ts`. The value shape simply outlived its key. An exported schema with
// no consumer is read as a capability (#3950), so it goes with it.
//
// ⚠️ `SharingConfigSchema` above is UNTOUCHED and is a LIVE door — see the module
// header. One file, two verdicts; that split is the point, and it is per SCHEMA.
//
// Embedding, if it is ever built, returns via the enforce route of ADR-0049:
// a route that honours the origins first, the vocabulary second.

// Type Exports
export type SharingConfig = z.input<typeof SharingConfigSchema>;
/** Post-parse shape of {@link SharingConfig} — defaults applied, transforms run (ADR-0122). */
export type SharingConfigParsed = z.infer<typeof SharingConfigSchema>;
