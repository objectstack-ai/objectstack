// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Writes nothing: not the tab title and not the favicon. It used to write
 * both, and both writes were removed for the same reason.
 *
 * ⛔ **It deliberately does not write `document.title`** (objectui#8637). It
 * used to — as `BrandingSync`, it assigned the BARE product name on every
 * `useLocation()` change, while `AppShell`'s `useAppShellBranding` assigns the
 * composed `"App label — Product name"` from an effect keyed on that string.
 * Two writers on one global, keyed on different inputs: navigating between two
 * pages of the same app changed `location` but not the composed title, so only
 * this one fired and the tab reverted to the bare product name until something
 * else changed the composed title. Measured in a real browser, not inferred —
 * the reading is on objectui#8637's pull request.
 *
 * The repair is one writer, not two careful ones: `useAppShellBranding` owns
 * `document.title` while a shell is mounted and restores the previous title
 * when it unmounts, so leaving an app no longer needs a route-keyed reset here.
 * ⛔ Do not re-add a title assignment to this component — that re-creates the
 * race, and `apps/console/src/__tests__/tabTitleAfterNavigation.test.tsx` is
 * the pin that goes red when it comes back.
 *
 * ⛔ **It deliberately does not write the favicon either** (objectui#10379).
 * It used to re-apply the operator favicon, `getFaviconUrl()`, from the same
 * `useLocation()`-keyed effect, while `useAppShellBranding` writes the app's
 * `branding.favicon` from an effect keyed on that URL. It was the same race:
 * navigating between two pages of an app with its own favicon changed
 * `location` but not the branding, so only this effect fired and the operator
 * favicon replaced the app's.
 *
 * The repair is the same one writer. `useAppShellBranding` owns the icon link
 * while a shell with a `branding.favicon` is mounted: it captures the `href` it
 * finds and puts it back when the shell unmounts (objectui#10040). What it
 * finds is the operator favicon, which the boot writes before React mounts (see
 * below) from a runtime config that is settled by then: `main.tsx` awaits
 * `initRuntimeConfig()` before `createRoot().render()`. So the route-keyed write
 * had nothing left to do. Its first run repeated the boot's write, and every
 * later run either repeated it again or overwrote an app's icon. A write kept
 * only on mount would still just repeat the boot, and it would be right only
 * while this component renders before the shell. That is an order-dependent
 * second writer, the thing this component exists not to be.
 * ⛔ Do not re-add a favicon write here, keyed on the route or on mount.
 * `apps/console/src/__tests__/faviconAfterNavigation.test.tsx` is the pin that
 * goes red, in both render orders.
 *
 * Boot-time writers are a different lifecycle and are left alone: the inline
 * script in `apps/console/index.html` and `main.tsx` both set the bare product
 * name and the operator favicon before React mounts. That is the correct tab
 * until a shell with an app label or an app favicon is on screen, and it is
 * what `useAppShellBranding` captures and restores. If the runtime config is
 * ever re-read after boot, the new operator favicon needs a writer that leaves
 * a mounted shell's icon alone; a route-keyed write here is not that writer.
 *
 * It renders nothing and runs no effect. It stays where `App.tsx` mounts it,
 * which is where a route-keyed write would come back, and both pins above
 * render this real component, so a write put back here fails them.
 */
export function FaviconSync() {
  return null;
}
