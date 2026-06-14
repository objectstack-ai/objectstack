// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Doc } from '@objectstack/spec/system';

/**
 * Studio app overview doc (ADR-0046), registered in this package's manifest so
 * it groups under "Studio" in the `/_console/docs` index.
 *
 * Authored inline rather than as a flat `src/docs/*.md` file because this is a
 * TS-first code package built by tsup, not a user app built by `os build` —
 * `defineStack({ docs })` / manifest `docs[]` is the supported path for those
 * (see `DocSchema` in `@objectstack/spec/system`). The `content` below is plain
 * CommonMark + GFM with no images/MDX, per ADR-0046 §3.4.
 *
 * Principle (from the HotCRM reference docs): document the *invisible*
 * business logic, not what the Studio UI already shows on screen.
 */
export const STUDIO_OVERVIEW_DOC: Doc = {
  name: 'studio_overview',
  label: 'Studio overview',
  description: 'Orientation for builders: the metadata-first model, overlay precedence, and publishing.',
  content: `# Studio overview

Studio is the builder app — the workbench for shaping the platform's
*metadata*: objects, fields, views, flows, agents, and the rest. Most of its
screens are self-explanatory; this page covers the one rule that is not visible
on screen but governs everything you do here. For the full reference, see
<https://docs.objectstack.ai>.

## Metadata-first

In Studio you do not edit a running database — you edit *definitions*. Every
object, field, and view is a metadata record, and the live application is
generated from that metadata. This is why a change in Studio can reshape the UI
and the API at once: you are changing the model, not patching a screen.

## Edits are overlays (the invisible rule)

Your changes do not mutate the metadata shipped by a package in place. Studio
writes an **overlay** on top of the base definition, and the runtime resolves
the two by precedence: an unpublished **draft** wins for you while you work, a
published **tenant overlay** wins over the package's baseline, and the package
baseline is the fallback (ADR-0005, ADR-0033). The practical consequence: the
base definition is never destroyed, so an overlay can always be reverted to
recover the original — and a field that "won't change" is usually being shadowed
by a higher-precedence layer.

## Publishing & deploying

A draft is visible only to you until you **publish** it, which promotes the
overlay so the rest of the tenant sees it. Moving changes between environments
(for example dev → production) is a separate **deploy** step, not an automatic
side effect of publishing — keeping the two distinct is what lets you build
safely in one environment before shipping.

See <https://docs.objectstack.ai> for drafts, overlays, and deployment in depth.
`,
};
