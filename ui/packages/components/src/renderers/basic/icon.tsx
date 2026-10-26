/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { IconSchema } from '@object-ui/types';
import { SquareDashed } from 'lucide-react';
import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { describeIconLookup, resolveIcon } from '../action/resolve-icon';

/**
 * The glyph rendered when the requested one does not resolve (objectui#5631).
 *
 * ## Why a placeholder at all
 *
 * This branch used to `return null`. That made an unresolvable icon invisible
 * in two independent ways at once, which is the whole reason objectui#5631
 * existed long enough to be found by accident:
 *
 *   - **Invisible to a human.** Nothing rendered. No error boundary, no gap
 *     that reads as broken — just an absent glyph a reviewer's eye completes.
 *   - **Invisible to a gate.** A renderer that returns `null` spreads no
 *     attributes, so the DOM-leak sweep in
 *     `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` scanned
 *     an empty tree and reported no findings. An empty scan and a clean scan
 *     are the same reading. `ui:icon` was one of twelve targets that read clean
 *     for exactly that reason, and it only started reporting its fourteen
 *     leaked attributes once the sweep forced a resolvable name onto it.
 *
 * The maintainer ruling of 2026-08-22 (issue #5631, comment 5380754137) makes
 * ending that silence unconditional — it holds "regardless of the key
 * question", i.e. independent of *which* schema key names the glyph.
 *
 * ## Why a NAMED IMPORT and not a lookup in the `icons` record
 *
 * A placeholder that itself fails to resolve is the original bug again, one
 * level up, and silent in the same way. Every other lookup in this file goes
 * through lucide's runtime `icons` record, and lucide retires a spelling by
 * dropping it from that record while keeping the deprecated named export —
 * the objectui#5622 mechanism. Measured on the installed lucide-react 1.31.0:
 * `CircleHelp` and `HelpCircle`, the two obvious "unknown" glyphs, are BOTH
 * absent from the `icons` record while both still resolve as named exports.
 * Either one looked up the usual way would have rendered nothing.
 *
 * A direct named import removes the failure mode instead of dodging it: it is
 * resolved at build time, so if lucide ever retires this spelling the build
 * fails loudly rather than the placeholder silently becoming another `null`.
 * `SquareDashed` is currently both a named export and present in the record,
 * and it is used DIRECTLY in the placeholder branch below rather than through a
 * module-scope alias — an alias reads to `react-refresh/only-export-components`
 * as a second component declaration in a file that exports none.
 */

/**
 * The DOM pass-through for this file's SVG host (objectui#5632, the
 * `BARE_SPREAD_ON_SVG` slice of objectui#5574).
 *
 * ## Why the BARE `toDomProps`, and not a declaration of its own
 *
 * The sibling slice for form controls needed one
 * (`../../lib/form-control-dom-props.ts`): `name` and `disabled` are legal
 * HTML on a control, so the element-agnostic SDUI list would have stripped
 * real attributes. The question has to be asked again per host, and for an
 * SVG icon the answer is the opposite one — MEASURED, not assumed:
 * `IconSchema` declares exactly `icon`, `size` and `color`, and this renderer
 * already CONSUMES all three by name (the glyph lookup, `sizeStyle`, and the
 * `cn()` class list). Not one of them needs to reach the element through a
 * spread, so nothing legitimate is withheld and no third declaration is
 * warranted. That count is over the keys an author can WRITE and this
 * renderer can RECEIVE — it never counted the `type` discriminant either,
 * and it does not count a `?: never` refuse-by-name, which is the tombstone
 * of an adjudicated-retired key: that key's own `@deprecated` line in
 * `packages/types/src/layout.ts` carries the verdict, under the maintainer
 * ruling recorded with the objectui#9256 family-D pin
 * (`packages/types/src/__tests__/content-channel-family-d-9256.test.ts`).
 *
 * ## What stops arriving, which is the half a leak gate cannot see
 *
 * The sweep gate reports attributes that arrive ILLEGITIMATELY. It has no case
 * for one that stops arriving, and on an SVG host the judge counts
 * `stroke` / `width` / `height` as legitimate — so all three changes below were
 * invisible to it in both directions and had to be read off the DOM directly:
 *
 *  - `color` reached lucide's own `color` prop and became `stroke`. Every
 *    authored `color` in the catalog is a Tailwind CLASS, which is what
 *    `IconSchema.color` declares ("Color Class") and what the `cn()` list
 *    already applies — so the spread was emitting `stroke="text-red-500"`, an
 *    invalid SVG paint value, next to the class that does the real work.
 *    Dropping it removes the garbage and leaves the declared path untouched.
 *  - `size` reached lucide's `size` prop and set the `width`/`height`
 *    ATTRIBUTES, duplicating the `sizeStyle` this renderer already writes. CSS
 *    `width`/`height` win over the SVG presentation attributes, so the authored
 *    size still renders from the style; only the redundant second channel goes.
 *  - `icon` itself landed on the element as `icon="check"` — 71 times in
 *    `examples/schema-catalog`, and the one leak this file's catalog probe
 *    measures.
 *
 * A key that genuinely belongs on this element is DECLARED and forwarded BY
 * NAME (objectui#4435), the way `style` is below. ⛔ Never reopen the spread
 * and never widen the shared list to reach one host (AGENTS.md #0.1).
 */
// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const IconRenderer = forwardRef<SVGSVGElement, { schema: IconSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: IconSchema; className?: string; [key: string]: any }, ref) => {
    // Extract designer-related props
    const { 
      'data-obj-id': dataObjId, 
      'data-obj-type': dataObjType,
      style,
      ...iconProps
    } = props;

    // Build size style
    const sizeStyle = schema.size ? { width: schema.size, height: schema.size } : undefined;

    // Merge classNames: schema color, schema className, prop className
    const mergedClassName = cn(
      schema.color,
      schema.className,
      className
    );

    // The glyph key is `icon` (objectui#5631, maintainer rulings 2026-08-22
    // option A and 2026-08-24 「5631 A′」). It used to be `name` — the SDUI
    // IDENTITY key every authored node carries — so an ordinary
    // `{ type:'icon', id:'save_icon', name:'save_icon' }` asked lucide for
    // `SaveIcon`, missed, and rendered nothing at all.
    //
    // ⛔ There is NO `schema.icon ?? schema.name` here, and there must not be.
    // The ruling excluded that shape by name, twice: it is the tolerant-consumer
    // pattern this family is migrating away from, and it would make `name` mean
    // "identity" or "glyph" depending on whether a lucide lookup happened to
    // hit. A node that still authors `name` is REFUSED by `IconSchema`, and if
    // it reaches this renderer unvalidated it lands in the placeholder branch
    // below — loud in both directions, silent in neither.
    //
    // `schema.icon` is typed `string` but arrives from authored JSON, so it can
    // be absent at runtime. It used to reach this file's own `toPascalCase`
    // unguarded, where `undefined.split` threw and the SchemaErrorBoundary
    // swallowed it — a third way for this renderer to fail without saying so.
    // The guard stays here rather than moving into the seam: the seam answers
    // `null` for an absent name, and this renderer must tell an ABSENT name
    // apart from an unresolvable one to pick its warning.
    const requested = typeof schema.icon === 'string' ? schema.icon : '';
    // Read ONLY to make the migration diagnostic below specific. ⛔ Never a
    // fallback glyph source: it is not consulted by the lookup, and a node
    // carrying it still renders the placeholder.
    const legacyGlyphName = typeof schema.name === 'string' && schema.name.length > 0
      ? schema.name
      : '';
    // The lookup itself goes through the ONE seam (objectui#5935). This file
    // carried its own `toPascalCase` + `iconNameMap` + `icons[...]` — the same
    // algorithm as `renderers/action/resolve-icon.ts`, written a second time,
    // with a NARROWER tokeniser (`split('-')`, so `arrow_right` missed here and
    // resolved on two other surfaces). That divergence is what this card ended.
    //
    // `describeIconLookup` supplies the two halves the objectui#5631 warning
    // below names (`lookup: "Home" -> "House"`) WITHOUT a second copy of the
    // normalisation. ⛔ It is not a second resolution path: `resolveIcon` is the
    // only thing consulted for what renders.
    const { pascal: iconName, key: mappedIconName } = describeIconLookup(requested);
    const Icon = requested ? resolveIcon(requested) : undefined;

    if (!Icon) {
      console.warn(
        `ui:icon: no lucide glyph resolves for ${requested ? `"${requested}"` : 'an absent icon name'}` +
          `${requested ? ` (lookup: "${iconName}"${mappedIconName !== iconName ? ` -> "${mappedIconName}"` : ''})` : ''}. ` +
          `Rendering a visible placeholder instead of nothing (objectui#5631).` +
          // The migration half. An author looking at a placeholder on a node
          // that used to work needs to be told the key moved — saying only
          // "no glyph resolves" would make a mechanical rename look like a
          // missing icon. Named separately from the generic case so it cannot
          // be mistaken for one.
          (!requested && legacyGlyphName
            ? ` This node names its glyph with the SDUI identity key \`name\`` +
              ` ("${legacyGlyphName}"), which is no longer read as a glyph name.` +
              ` Rename it: \`icon: "${legacyGlyphName}"\`. Stored metadata converts in` +
              ` bulk with \`migrateIconNodeKeys\` from \`@object-ui/types\`.`
            : '')
      );

      // Same host element and the same authored box as a resolved icon, so the
      // gap is visible exactly where the glyph would have been. `role`/
      // `aria-label` sit BEFORE the spread so an author can still override
      // them; the marker attribute sits AFTER it so nothing can clobber the
      // one hook a gate uses to find this branch.
      return (
        <SquareDashed
          ref={ref}
          role="img"
          aria-label={
            requested
              ? `Unresolved icon: ${requested}`
              : legacyGlyphName
                ? `Unresolved icon: \`name\` is no longer the icon key, rename it to \`icon\` (${legacyGlyphName})`
                : 'Unresolved icon'
          }
          className={mergedClassName}
          style={{ ...sizeStyle, ...style }}
          {...toDomProps(iconProps)}
          // Apply designer props
          {...{
            'data-obj-id': dataObjId,
            'data-obj-type': dataObjType,
            'data-objectui-icon-unresolved': requested || '(none)',
            // Present ONLY on the legacy shape, so a gate (and a designer) can
            // tell "author wrote a glyph name that does not resolve" apart from
            // "author has not migrated this node yet" (objectui#5631).
            ...(!requested && legacyGlyphName
              ? { 'data-objectui-icon-legacy-name-key': legacyGlyphName }
              : {}),
          }}
        />
      );
    }

    return (
      <Icon 
        ref={ref} 
        className={mergedClassName}
        style={{ ...sizeStyle, ...style }}
        {...toDomProps(iconProps)}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType }}
      />
    );
  }
);

IconRenderer.displayName = 'IconRenderer';

ComponentRegistry.register('icon',
  IconRenderer,
  {
    namespace: 'ui',
    label: 'Icon',
    // objectui#5622 — `face-slightly-smiling`, NOT `smile`, in BOTH places
    // below. Every lookup in this file goes through lucide's runtime `icons`
    // record, and lucide retires a spelling by dropping it from that record
    // while keeping it as a deprecated named export. `Smile` is gone from the
    // record, so this component's own declared default resolved to nothing:
    // the palette entry's glyph was blank and an `icon` dropped in from the
    // palette rendered nothing plus the `console.warn` below. The two spots
    // must move together — repairing one alone leaves either the default
    // rendering nothing or the palette glyph blank.
    //
    // `face-slightly-smiling` is the record's own spelling of the SAME glyph
    // object (`Smile === FaceSlightlySmiling` is true on the installed
    // lucide), so the palette looks exactly as it did — this is a spelling
    // repair, not a redesign of the default.
    icon: 'face-slightly-smiling',
    category: 'basic',
    inputs: [
      // objectui#5631 — this entry declares `icon`, and it moved in the SAME
      // change as the resolver above, by construction.
      //
      // It advertised `name` up to PR #5959, deliberately: renaming it while
      // the resolver still read `name` would have been this card's own defect
      // pointing the other way — a declared input list naming a key nothing
      // reads. That note retires here, under the 2026-08-24 ruling
      // 「5631 A′，按一次正经的契约迁移立项。」, because the contract, the
      // resolver, the corpus and this list all move together.
      //
      // The `name:` on the left is the INPUT DESCRIPTOR's own key — which
      // schema property this input edits. Its value is what changed.
      { name: 'icon', type: 'string' },
      { name: 'size', type: 'number' },
      { name: 'color', type: 'string' },
      { name: 'className', type: 'string' }
    ]
  }
);
