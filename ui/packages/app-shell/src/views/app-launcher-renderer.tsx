/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `app:launcher` — the app launcher grid, addressable from a page schema
 * (`969ba84f4`).
 *
 * ## Why this exists
 *
 * `app:launcher` is a first-class member of `@objectstack/spec`'s
 * `PageComponentType`. The maintainer ruling of 2026-08-26 (objectstack#12183)
 * kept it declared and made it Phase 1 of the decomposition precisely because
 * it is PURELY METADATA-DRIVEN: the app list is metadata the shell already
 * holds, so nothing had to ship before the renderer could. Nothing rendered it,
 * so a page that authored it drew a dashed box.
 *
 * ⚠️ The two Phase 1 members were NOT symptomatic in the same way, which is
 * worth recording because it changes what "before" means for each. Measured on
 * `592acafbe`, in a harness that imports `@object-ui/components` and nothing
 * else:
 *
 *   - `nav:menu` is in `PALETTE_PLACEHOLDER_BLOCKS`, registered EAGERLY, so it
 *     drew `PlaceholderRenderer`'s literal "Component Placeholder" scaffold in
 *     every host;
 *   - `app:launcher` is only in `PROTOCOL_COMPONENTS`, registered solely when a
 *     host opts in via `registerPlaceholders()` — which just `apps/console`
 *     does (`apps/console/src/main.tsx:53`). So it drew the scaffold in the
 *     console (which is what objectstack#12183 measured in a browser) and
 *     `SchemaRenderer`'s red OBJUI-001 "Unknown component type" panel
 *     everywhere else.
 *
 * ## What backs it — nothing new
 *
 * The app registry: `useMetadata().apps`, which `MetadataProvider` fetches
 * eagerly (`app` is in its `EAGER_TYPES`, i.e. `GET /api/v1/meta/app` on
 * mount). That is the SAME read the top-bar `AppSwitcher` and the Home page
 * make, and the openable-apps filter is the shared `filterActiveApps` helper
 * rather than a second copy of the `active`/`hidden` rule. This is the ruling's
 * "no external data-source dependency" claim, discharged: the block issues no
 * request of its own and reaches no adapter.
 *
 * The grid itself is `HomeAppsStrip` — the console's existing launcher, already
 * the answer to "how does this product draw a wall of apps" — so an authored
 * launcher and the Home launcher cannot drift into two looks for one thing.
 *
 * ## Declared propless, deliberately
 *
 * `ComponentPropsMap['app:launcher']` is an EMPTY shape ("declares no props at
 * all" is the recorded intent), so this registration publishes NO `inputs`.
 * Declaring even `className` here would advertise an authoring key the contract
 * rejects by name — the forward direction of
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` is a vice on
 * exactly that move. The node-level `className` the SchemaRenderer threads
 * through is a NODE key (`PageComponentSchema`), not a prop.
 *
 * One consequence of propless-ness worth stating rather than leaving implicit:
 * `HomeAppsStrip`'s marketplace shortcut is gated on `isAdmin`, and this block
 * passes `false`. Installing a template is a Home-page/admin affordance, and
 * with an empty prop shape there is no authoring key that could ever turn it on
 * — so wiring the admin probe here would publish behaviour no author can
 * address, describe or disable.
 *
 * Registered in app-shell rather than `@object-ui/components` for the same
 * reason `global:search` is (`f99932a42`): the providers are here.
 * `@object-ui/components` depends on neither `@object-ui/layout` nor
 * `react-router-dom` (measured against its `package.json` on `592acafbe`), and
 * this block needs the router to open an app. The eager palette placeholder in
 * `components/renderers/placeholders.tsx` STAYS: it is the fallback for a host
 * that embeds `@object-ui/components` without app-shell, and this module
 * imports that package, so its registration always runs first and this one
 * overwrites it.
 *
 * This does NOT put the block in the Studio page palette: `PALETTE_EXCLUSIONS`
 * still records `app:launcher` as a shell singleton, and that is a palette
 * decision about authoring ergonomics, independent of whether a declared type
 * renders — exactly as `f99932a42` left `global:notifications`.
 */

import * as React from 'react';
import { useMemo } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { useMetadata } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { HomeAppsStrip } from '../console/home/HomeAppsStrip.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { filterActiveApps } from '../utils/index.js';

/** Keep the designer's own data attributes on the wrapper, drop the rest. */
const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style } = props || {};
  return { 'data-obj-id': id, 'data-obj-type': type, style };
};

export interface AppLauncherRendererProps {
  schema?: Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const AppLauncherRenderer: React.FC<AppLauncherRendererProps> = ({
  className,
  schema: _schema,
  ...props
}) => {
  const { t } = useObjectTranslation();
  const { apps } = useMetadata();
  const { favorites } = useFavorites();

  // The openable set, through the SHARED predicate — `active !== false &&
  // hidden !== true`. Two copies of "an app the user can open" is precisely
  // the dialect `filterActiveApps` exists to prevent.
  const openable = useMemo(() => filterActiveApps(apps as any[]), [apps]);

  return (
    <nav
      className={className}
      aria-label={t('console.nav.launcherLabel', { defaultValue: 'App launcher' }) as string}
      data-block="app:launcher"
      {...splitDesigner(props)}
    >
      <HomeAppsStrip
        apps={openable}
        favorites={favorites}
        // See the header: with an empty prop shape there is no authoring key
        // that could address the marketplace shortcut, so it is not offered.
        isAdmin={false}
        onBrowseMarketplace={() => {}}
      />
    </nav>
  );
};

// Bare name + namespace (the registry prepends it itself); `skipFallback: true`
// keeps this off the top-level `launcher` key. No `inputs`: the spec shape is
// empty.
ComponentRegistry.register('launcher', AppLauncherRenderer, {
  namespace: 'app',
  skipFallback: true,
  category: 'navigation',
  label: 'App Launcher',
  icon: 'LayoutGrid',
});

export default AppLauncherRenderer;
