
import { Spinner, Button } from '@object-ui/components';
import { Database, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { getProductName, getLogoUrl } from '../runtime-config.js';
import { en as enLocale, getLoadedBuiltInLocales, useObjectTranslation } from '@object-ui/i18n';

interface LoadingScreenProps {
  /** Optional message override */
  message?: string;
  /** When set, renders an error block instead of the spinner */
  error?: string | null;
  /** Optional retry callback; renders a Retry button when provided alongside `error` */
  onRetry?: () => void;
  /** When true, disables the retry button and shows a spinner */
  retrying?: boolean;
}

// Bootstrap-critical UI: drawn on every full page load before the app's data
// arrives, and on the server-down boot where nothing else loads. The product
// name is read from the runtime-config singleton (sync) so it reflects
// server-pushed branding when available, falling back to 'ObjectOS'.
//
// ONE LINE, NO STEPS (objectui#12187). This screen used to walk three steps on
// a 1200 ms timer that tracked no real work, under a line about "setting up a
// new environment" that was never one. Both are gone: product name, one line,
// a spinner.
//
// WHICH LANGUAGE. The I18nProvider's, read through `useObjectTranslation()`.
// This used to read `document.documentElement.lang`, which the provider writes
// in a passive effect — after its children's first render. So the first paint
// read the document's static `lang="en"` on every browser, and the screen
// stayed English until something re-rendered it: the step timer's first tick,
// 1200 ms in. The provider's own state holds the resolved language on its first
// render, and the hook re-renders this screen when the language changes or a
// catalogue lands. `LoadingScreen.bootCopy-12187.test.tsx` pins the first
// commit against a `zh-CN` browser with `<html lang="en">`.
//
// The hook does not suspend here: the provider's instance comes from
// `createI18n`, which sets `react.useSuspense: false` for exactly the boot
// suspension an earlier note on this file warned about, and the `Spinner`
// below calls the same hook. Outside any provider it reports `en`, as it does
// for every other renderer.
//
// NO ENGLISH BEFORE THE LOCALE. The copy is not read through `t()`: `t()`
// answers a pack still in flight through `fallbackLng: 'en'`, which is the
// English this screen must not show. It is read off the RESIDENT built-in
// catalogue for the active language, as plain properties, and the line is
// absent — not English — while that catalogue is not resident. The console
// awaits the active catalogue before its first render (`preloadBootstrapLocale`,
// objectui#7479), so there the line is present from the first paint; a host
// that does not await shows the product name and the spinner until the
// catalogue's store write re-renders this screen. ⛔ Do not "fix" that wait by
// importing the ten packs back in — that is the eager payload objectui#7479
// removed, and `check:eager-locale-catalogues` fails on it.
//
// The error block alone still degrades to `en` field by field: an error must
// say something, and a pack behind on a `console.*` key must render English
// there rather than `undefined` (objectui#2872 part (a)).
//
// THE MARKER. The root carries `data-boot-splash` in every state — loading,
// `message` and error. (The pre-JS splash in `apps/console/index.html` is a
// different element, `#boot-splash`, removed once React first commits.) It is this
// screen's one language-independent hook: a readiness wait or a smoke test
// that needs to know whether the splash is still up asks for that attribute,
// never for the line, which is language-dependent by design and absent until
// the active catalogue lands. A wait keyed on the copy passes at once while
// the splash is still up (objectui#12187, round 2).
type ConsoleStrings = typeof enLocale.console;

interface StartupStrings {
  /** The one status line, or `null` while the active language's pack is not resident. */
  line: string | null;
  error: ConsoleStrings['error'];
  actions: ConsoleStrings['actions'];
}

function getStartupStrings(language: string): StartupStrings {
  const resident = getLoadedBuiltInLocales();
  // Exact tag first, then its base language — the registry's own order. An
  // empty language has resolved nothing, so it has no catalogue and no line.
  // `as unknown as` because a catalogue is typed by SHAPE here while
  // `enLocale` carries `en`'s literal VALUES — the same cast `createI18n` makes.
  const catalogue = (
    language ? (resident[language] ?? resident[language.toLowerCase().split('-')[0]]) : undefined
  ) as unknown as { console?: Partial<ConsoleStrings> } | undefined;
  const pack = catalogue?.console;
  return {
    line: pack?.initializing ?? null,
    error: { ...enLocale.console.error, ...pack?.error },
    actions: { ...enLocale.console.actions, ...pack?.actions },
  };
}

export function LoadingScreen({ message, error, onRetry, retrying }: LoadingScreenProps) {
  const { language } = useObjectTranslation();
  const strings = getStartupStrings(language);

  return (
    <div data-boot-splash="" className="flex flex-col items-center justify-center h-screen bg-background">
      <div className="flex flex-col items-center gap-6">
        {/* Logo/Icon */}
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-xl animate-pulse" />
          <div className="relative bg-linear-to-br from-primary to-primary/80 p-4 rounded-2xl shadow-lg">
            {getLogoUrl() ? (
              <img src={getLogoUrl()} alt={getProductName()} className="h-10 w-10 object-contain" />
            ) : (
              <Database className="h-10 w-10 text-primary-foreground" />
            )}
          </div>
        </div>

        {/* Title. The line's height is reserved, so its arrival does not move the screen. */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{getProductName()}</h1>
          <p className="min-h-5 text-sm text-muted-foreground">{strings.line}</p>
        </div>

        {/* Error block */}
        {error ? (
          <div className="flex flex-col items-center gap-4 max-w-md w-full px-6">
            <div className="flex flex-col items-center gap-3 p-5 rounded-lg border border-destructive/30 bg-destructive/5 w-full">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="text-sm font-semibold">
                  {strings.error.connectionFailed}
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-center break-words">
                {error}
              </p>
              <p className="text-xs text-muted-foreground text-center">
                {strings.error.checkServer}
              </p>
            </div>
            {onRetry && (
              <Button
                onClick={onRetry}
                disabled={retrying}
                variant="default"
                size="sm"
                className="gap-2"
              >
                {retrying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {strings.actions.retrying}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {strings.actions.retry}
                  </>
                )}
              </Button>
            )}
          </div>
        ) : message ? (
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 rounded-full">
            <Spinner className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">{message}</span>
          </div>
        ) : (
          <Spinner className="h-5 w-5 text-primary" />
        )}
      </div>
    </div>
  );
}
