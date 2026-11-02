/**
 * Main Entry Point
 *
 * Renders the React application.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App';
import { I18nProvider, preloadBootstrapLocale } from '@object-ui/i18n';
import {
  MobileProvider,
  cacheLoadedResources,
  generatePWAManifest,
  getNativeHost,
  registerServiceWorker,
} from '@object-ui/mobile';
import { registerPlaceholders } from '@object-ui/components';
import { initSentry, initRuntimeConfig, getProductName, getProductShortName, getFaviconUrl, getPwaDescription, getPwaThemeColor } from '@object-ui/app-shell';
import { loadLanguage } from './loadLanguage';
import { loadLocales } from './loadLocales';
import { seedTenantLanguage } from './languageSeed';
import { preflightAuth } from './lib/auth-preflight';
import { withConsoleBaseRootRelative } from './utils/consoleBase';
import { resolveManifestIcons } from './pwaManifestIcons';

const AUTH_URL = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

// ────────────────────────────────────────────────────────────────────────────
// Plugin registration
// ────────────────────────────────────────────────────────────────────────────
//
// The SDUI block layer (eager core views + lazy heavy plugins) lives in its own
// module so it can be imported without booting the app — the public-contract
// test and the manifest dump both read the REAL list from there rather than
// keeping a copy that can drift (objectui#2953).
import './register-plugins';

// Register `developer:*` component refs.
import './registerDeveloperComponents';

// Register `studio:*` component refs (the application-builder entry).
import './registerStudioComponents';

// Register `account:*` component refs (My Profile, etc.).
import './registerAccountComponents';

// Register `approvals:*` component refs (the Approvals Inbox entry).
import './registerApprovalsComponents';

// Register `audit:log` and `ai:approvals` component refs (objectui#10520).
import './registerSystemComponents';

// Register the `chatbot*` node types as lazy stubs (objectui#13410).
import './registerChatbotComponents';

// (Per-type metadata-admin override for `object` was removed: the
// `object` type now uses the same generic ResourceListPage as every
// other metadata type for visual consistency. The visual ObjectManager
// designer is still available from the object's edit page preview.)

// Register placeholder fallbacks for any protocol-defined component types
// that don't yet have a real renderer (e.g. ai:chat_window). Must run AFTER
// all real plugin registrations above so it only fills the gaps and never
// shadows a registered renderer.
registerPlaceholders();

// Resolve server-pushed runtime config + drop stale Bearer tokens BEFORE
// React mounts. `initRuntimeConfig()` populates the singleton consumed by
// marketplace + install code paths (cloud URL, capability flags) — without
// it the SPA would fall back to defaults on first paint and hit 404s.
// Both kicks are awaited so first paint sees definitive values, but each
// one absorbs its own failures so a missing endpoint never blocks boot.
// `index.html`'s pre-boot branding script resolves this SAME variable through
// Vite's HTML env substitution, so both callers build one `/api/v1/runtime/config`
// URL and share one request instead of asking two servers (objectui#5660).
// Change the spelling here and that script has to change with it;
// `src/__tests__/runtimeConfigBootDedup.test.ts` fails when the two stop agreeing.
const SERVER_BASE = (import.meta.env.VITE_SERVER_URL || '').replace(/\/+$/, '');

/**
 * The Console's mount as an absolute URL with its trailing slash
 * (`https://host/_console/`): the Service Worker's scope and the installed
 * app's `start_url` and `scope`. `/` resolves through the same
 * `withConsoleBaseRootRelative` the auth pages use, so it agrees with where a
 * full-page navigation lands under every mount.
 */
const CONSOLE_SCOPE = new URL(withConsoleBaseRootRelative('/'), window.location.origin).href;

// The third entry seeds the UI language from the server's resolved locale for
// the signed-in caller (objectui#4035). It joins this existing gate rather than adding one of its
// own, which is what keeps it off the critical path: it runs CONCURRENTLY with
// the two round-trips above, is bounded at ~500ms, absorbs every failure, and
// short-circuits to a no-op on every boot except a device's true first visit
// (any later boot reads its answer synchronously out of the seed cache).
Promise.all([
  initRuntimeConfig(SERVER_BASE),
  preflightAuth(AUTH_URL),
  seedTenantLanguage(SERVER_BASE),
]).finally(async () => {
  // The active locale's catalogue, fetched before the first render
  // (objectui#7479). `@object-ui/i18n` ships its ten catalogues as separate
  // chunks now, so without this await a `zh-CN` viewer would paint once in the
  // `en` fallback and re-render in Chinese a moment later — the flash the
  // seed race above already refuses to introduce, arriving from a different
  // direction.
  //
  // ⛔ Ordering is load-bearing: this runs AFTER the `Promise.all`, never
  // inside it. `seedTenantLanguage` is what writes the seed this reads,
  // and tier 2 of the precedence chain is that seed — resolving concurrently
  // would preload whatever the previous boot left behind.
  //
  // `hasLoader: true` because this app passes `loadLanguage` below; the two
  // must agree or the provider boots into a language other than the one
  // preloaded here. It never rejects: a catalogue that will not download must
  // not take the boot down, and the provider retries on mount.
  await preloadBootstrapLocale({ hasLoader: true });

  // Kick off Sentry init (no-op unless this runtime served a DSN on
  // `telemetry.errorReporting`). Still not awaited — observability must never
  // block first paint.
  //
  // ⛔ Ordering is load-bearing, not stylistic, and objectstack#12681 made it
  // MORE so: the DSN itself now arrives from the server, so before
  // `initRuntimeConfig()` settles there is no sink at all. This call used to
  // run at module-eval time, BEFORE `initRuntimeConfig()` was even started;
  // from there it reads "no sink" on every boot and memoizes that verdict —
  // turning the operator's only switch into a permanent removal, silently,
  // including for the hosted console. Reading a server value requires waiting
  // for the server. `.finally()` (not `.then()`) keeps the pre-existing
  // guarantee that a failed config fetch never blocks boot — and on that path
  // no sink arrived, so the failure direction is silence.
  void initSentry();

  // Apply runtime branding before React mounts — avoids a flash of the
  // static defaults for operators who configure OS_PRODUCT_NAME etc.
  document.title = getProductName();

  // Inject dynamic favicon if the operator configured one.
  const faviconUrl = getFaviconUrl();
  if (faviconUrl) {
    const link = document.getElementById('favicon') as HTMLLinkElement | null;
    if (link) {
      link.href = faviconUrl;
      // Update type attr when switching from svg to png
      link.type = faviconUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    }
  }

  // Generate a dynamic PWA manifest from runtime branding and inject it.
  // Blob URL replaces the static /manifest.json so PWA install prompts use
  // the branded name, short name, description, theme color, and favicon.
  // Inside the ObjectStack mobile shell (`window.ObjectStackNative`) the static
  // manifest is removed and none is injected: the app is installed natively
  // there, so an install manifest offers nothing. Read here, after the boot
  // round-trips, not at module load; a bridge that lands even later only
  // leaves the manifest in place, which a WebView never acts on.
  const existingManifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (existingManifest) existingManifest.remove();
  if (!getNativeHost()) void injectPwaManifest(faviconUrl);

  // The Console's Service Worker (objectstack#29155): the offline app shell
  // and the push handlers. Not awaited — it must never hold up first paint.
  void syncServiceWorker();

  // The two loaders wait for this page load's session answer. Signed in, they
  // read `/i18n` with the session's credentials; signed out, they request
  // nothing and the sign-in page renders from the built-in packs
  // (objectui#12034, `./i18nSession.ts`).
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MobileProvider pwa={{ enabled: true, name: getProductName(), shortName: getProductShortName() }}>
        <I18nProvider loadLanguage={loadLanguage} loadLocales={loadLocales}>
          <App />
        </I18nProvider>
      </MobileProvider>
    </React.StrictMode>
  );
});

/**
 * Generates the Console's web app manifest from runtime branding and links it
 * as a Blob URL. Not awaited: a raster branding favicon is measured first
 * (`./pwaManifestIcons.ts`), and that load must never hold up first paint, so
 * the manifest link lands once the measurement settles.
 */
async function injectPwaManifest(faviconUrl: string | undefined): Promise<void> {
  const icons = await resolveManifestIcons(faviconUrl, document.baseURI);
  const manifestJson = generatePWAManifest({
    enabled: true,
    name: getProductName(),
    shortName: getProductShortName(),
    description: getPwaDescription(),
    themeColor: getPwaThemeColor(),
    backgroundColor: '#ffffff',
    display: 'standalone',
    // Absolute URLs, because a Blob URL is no base to resolve `./` against:
    // the installed app opens at, and stays inside, the Console's mount.
    startUrl: CONSOLE_SCOPE,
    scope: CONSOLE_SCOPE,
    orientation: 'any',
    icons,
  });
  const blob = new Blob([JSON.stringify(manifestJson)], { type: 'application/json' });
  const manifestLink = document.createElement('link');
  manifestLink.rel = 'manifest';
  manifestLink.href = URL.createObjectURL(blob);
  document.head.appendChild(manifestLink);
}

/**
 * Registers the Console's Service Worker (`service-worker.js`, emitted at the
 * build root by `vite.config.ts`) under the Console's own scope, never the site
 * root. It is the `@object-ui/mobile` `'app-shell'` worker: API requests stay
 * network-only, the HTML entry is network-first, so the next navigation after a
 * deploy always runs the new build (the worker installs with `skipWaiting` and
 * no reload prompt is needed).
 *
 * Inside the ObjectStack mobile shell (`getNativeHost()`), the shell owns
 * offline: no worker is registered, and one this Console registered earlier in
 * the same WebView is unregistered. A bridge that lands after this read leaves
 * that page load's worker in place; the next load, which sees the bridge at
 * boot, removes it.
 *
 * Production builds only: a dev server's modules are not hashed build output.
 */
async function syncServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    if (getNativeHost()) {
      const registration = await navigator.serviceWorker.getRegistration(CONSOLE_SCOPE);
      if (registration?.scope === CONSOLE_SCOPE) await registration.unregister();
      return;
    }
    if (!import.meta.env.PROD) return;
    const registration = await registerServiceWorker({
      url: `${CONSOLE_SCOPE}service-worker.js`,
      scope: CONSOLE_SCOPE,
    });
    if (!registration) return;
    // Cache what this load fetched before the worker controlled it — the
    // first visit's lazy chunks — so an offline start finds them. Read off this
    // registration, not `serviceWorker.ready`, which waits on the page's URL.
    cacheLoadedResources(await whenActive(registration));
  } catch {
    // A refused registration costs the offline shell, never the page.
  }
}

/** The registration's worker once it is active (at once when it already is). */
function whenActive(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.active) return Promise.resolve(registration.active);
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve(worker);
      else if (worker.state === 'redundant') resolve(registration.active);
    });
  });
}
