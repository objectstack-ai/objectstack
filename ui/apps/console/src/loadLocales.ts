/**
 * Load the list of locales this app actually ships (objectui#4039).
 *
 * The @objectstack/spec REST API (`GET /api/v1/i18n/locales`) answers with the
 * standard envelope wrapping locale *descriptors*, not bare codes:
 * `{ data: { locales: [{ code, label, isDefault }] } }` — the shape
 * `GetLocalesResponseSchema` declares and both serving surfaces (the runtime
 * dispatcher's `/i18n` domain and `service-i18n`'s own route) emit through the
 * shared `toLocaleDescriptors`. Only `code` is read here: that helper sets
 * `label` to the code itself, so the descriptor's label is not a display name
 * and the switcher names locales for itself.
 *
 * Sibling of {@link ./loadLanguage.ts} and deliberately the same shape — same
 * `VITE_SERVER_URL` base, same envelope-first / flat-fallback parse for mock
 * and local-dev servers, same degrade-quietly contract. A language menu is
 * never worth taking the console down for: every failure returns `[]`, which
 * the provider reads as "I don't know" and answers with the built-in packs.
 *
 * Same session rule as the sibling too (objectui#12034, see `./i18nSession.ts`):
 * the read waits for this page load's session answer and is made only when
 * signed in, with the session's credentials. Signed out, it requests nothing
 * and answers `[]`.
 *
 * And it waits for the console's first paint ({@link whenBootPainted},
 * objectui#12980). Nothing on that paint reads the list: it feeds the globe
 * menu, which opens on a click, and the signed-in user's language column,
 * which is itself applied after the paint. Until it answers, the provider
 * offers the built-in packs, as it does for any `[]`.
 */
import { i18nFetch, whenSessionAnswered } from './i18nSession';

/** The boot splashes: `LoadingScreen`'s marker, and the pre-JS one in `index.html`. */
const BOOT_SPLASH_SELECTOR = '[data-boot-splash], #boot-splash';

let bootPainted: Promise<void> | null = null;

/**
 * Resolves once the console has painted past its boot splash: no splash in the
 * document, and a frame painted after that (objectui#12980). One promise per
 * page load, so every reader that waits on it is released by the same paint.
 *
 * Shared by the console's two readers whose answer no first-paint surface
 * needs, this one and `WorkspaceTimezonePrompt`'s settings read. It waits on
 * the splash's DOM marker rather than on any one component, because both are
 * mounted beside the routes, under the splash. A tab opened in the background
 * paints no frame, so it resolves when the tab is first shown.
 */
export function whenBootPainted(): Promise<void> {
  if (bootPainted) return bootPainted;
  bootPainted = new Promise<void>((resolve) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    const splashShown = () => document.querySelector(BOOT_SPLASH_SELECTOR) !== null;
    const afterNextPaint = (fn: () => void) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
      else setTimeout(fn, 0);
    };
    const settle = (): void => {
      if (!splashShown() || typeof MutationObserver !== 'function') {
        resolve();
        return;
      }
      const observer = new MutationObserver(() => {
        if (splashShown()) return;
        observer.disconnect();
        afterNextPaint(settle);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    afterNextPaint(settle);
  });
  return bootPainted;
}

/** Test seam: forget the paint, so a case can wait for it again. Not public. */
export function __resetBootPainted(): void {
  bootPainted = null;
}

export async function loadLocales(): Promise<string[]> {
  // The paint first, the session after it: the session is asked at the moment
  // the read would go out, so a sign-out while the paint was pending sends
  // nothing rather than an anonymous read.
  await whenBootPainted();
  if (!(await whenSessionAnswered())) return [];
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL || '';
    const res = await i18nFetch(`${serverUrl}/api/v1/i18n/locales`);
    if (!res.ok) {
      console.warn(`[i18n] Failed to load the app locale list: HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    // Unwrap the spec REST API envelope when present; mock / local-dev servers
    // may answer with the bare `{ locales: [...] }` body or a plain array.
    const raw = json?.data?.locales ?? json?.locales ?? json;
    if (!Array.isArray(raw)) {
      console.warn('[i18n] Unexpected /i18n/locales payload; ignoring.');
      return [];
    }
    const codes: string[] = [];
    for (const entry of raw) {
      // Descriptors are the contract; a bare string is tolerated only because
      // `getLocales()` hands back `string[]` and older mocks pass it straight
      // through — the very drift the shared descriptor mapping exists to stop.
      const code = typeof entry === 'string' ? entry : entry?.code;
      if (typeof code === 'string' && code.length > 0 && !codes.includes(code)) codes.push(code);
    }
    return codes;
  } catch (err) {
    console.warn('[i18n] Failed to load the app locale list:', err);
    return [];
  }
}
