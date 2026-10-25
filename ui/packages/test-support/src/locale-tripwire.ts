/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The runtime locale tripwire (objectui#9786, shared by objectui#9909).
 *
 * ## What it is for
 *
 * `useDisplayLocale` (`@object-ui/i18n`) states the rule in its own doc
 * comment: a caller must never hand `Intl` the `undefined` it gets on an
 * unconfigured workspace, because `undefined` means the MACHINE's locale,
 * which is neither of the repo's locale channels. The repo-wide source census
 * (`packages/i18n/src/__tests__/machineLocaleCensus-9909.test.ts`) refuses a
 * bare or `undefined`-argument call site the moment it is written, but a
 * source scan is blind to a call that passes a VARIABLE which happens to be
 * `undefined` at runtime — an optional prop no caller supplies, a default, a
 * spread. `HistoryTimeline`'s `locale` prop was exactly that, and no grep of
 * any shape could see it.
 *
 * This instrument closes that hole by observing the ARGUMENT every
 * locale-taking intrinsic actually receives while a surface renders. It was
 * written inside `plugin-detail`'s differential pin and moved here when
 * objectui#9909 applied the same pin pattern to every surface its sweep
 * changed — one instrument, not a copy per package.
 *
 * ## What it patches, and why each one
 *
 * - The `Intl` constructors — reached through the global object at call time,
 *   so replacing the property is enough.
 * - `Date.prototype.toLocale{,Date,Time}String` and
 *   `Number.prototype.toLocaleString` — these do NOT go through the global
 *   `Intl.DateTimeFormat` / `Intl.NumberFormat`; the engine reaches its own
 *   intrinsics. Patching only `Intl` would leave every
 *   `n.toLocaleString()` invisible, and a number face is half this class.
 *
 * Everything is restored in a `finally`, so a failing case cannot leak a
 * patched intrinsic into the next one.
 *
 * ## ⚠️ The disguised machine locale
 *
 * `'default'` is a structurally well-formed language subtag that no locale
 * data answers, so `Intl` resolves it to the runtime default — measured:
 * under `LANG=de_DE.UTF-8`, `Intl.DateTimeFormat('default').resolvedOptions()`
 * reports `de-DE`. {@link isMachineLocale} therefore counts it with the absent
 * and the `undefined` tag; an argument check that only asked "was a tag
 * passed?" would wave it through.
 */

export interface LocaleCall {
  /** `Intl.DateTimeFormat`, `Date.prototype.toLocaleDateString`, … */
  api: string;
  /** The first argument as passed — `undefined` both when absent and when explicit. */
  locale: unknown;
  /** How many arguments the call site actually passed. */
  argc: number;
}

/** Every `Intl` constructor whose FIRST argument is a BCP-47 tag. */
export const LOCALE_TAKING_INTL_CONSTRUCTORS = [
  'DateTimeFormat',
  'NumberFormat',
  'RelativeTimeFormat',
  'ListFormat',
  'PluralRules',
  'Collator',
  'DisplayNames',
  'Segmenter',
  'DurationFormat',
] as const;

const DATE_METHODS = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const;

type Restore = () => void;

function install(calls: LocaleCall[]): Restore {
  const intl = Intl as unknown as Record<string, unknown>;
  const intlOriginals = new Map<string, unknown>();
  const dateOriginals = new Map<string, (...a: unknown[]) => string>();
  const numberOriginal = Number.prototype.toLocaleString as (...a: unknown[]) => string;

  for (const name of LOCALE_TAKING_INTL_CONSTRUCTORS) {
    const Original = intl[name];
    // Not every runtime ships every constructor (`DurationFormat` is recent).
    if (typeof Original !== 'function') continue;
    intlOriginals.set(name, Original);
    const Patched = function (this: unknown, ...args: unknown[]) {
      calls.push({ api: `Intl.${name}`, locale: args[0], argc: args.length });
      return new (Original as new (...a: unknown[]) => object)(...args);
    } as unknown as Record<string, unknown>;
    // `supportedLocalesOf` and the prototype are part of the shape callers see.
    Object.setPrototypeOf(Patched, Original as object);
    (Patched as { prototype?: unknown }).prototype = (Original as { prototype: unknown }).prototype;
    intl[name] = Patched;
  }

  for (const name of DATE_METHODS) {
    const original = Date.prototype[name] as (...a: unknown[]) => string;
    dateOriginals.set(name, original);
    (Date.prototype as unknown as Record<string, unknown>)[name] = function (this: Date, ...args: unknown[]) {
      calls.push({ api: `Date.prototype.${name}`, locale: args[0], argc: args.length });
      return original.apply(this, args);
    };
  }

  (Number.prototype as unknown as Record<string, unknown>).toLocaleString = function (
    this: number,
    ...args: unknown[]
  ) {
    calls.push({ api: 'Number.prototype.toLocaleString', locale: args[0], argc: args.length });
    return numberOriginal.apply(this, args);
  };

  return () => {
    for (const [name, original] of intlOriginals) intl[name] = original;
    for (const [name, original] of dateOriginals) {
      (Date.prototype as unknown as Record<string, unknown>)[name] = original;
    }
    (Number.prototype as unknown as Record<string, unknown>).toLocaleString = numberOriginal;
  };
}

/**
 * Run `body` with every locale-taking API instrumented, and return what each
 * call site actually handed it.
 */
export function recordLocaleArguments(body: () => void): LocaleCall[] {
  const calls: LocaleCall[] = [];
  const restore = install(calls);
  try {
    body();
  } finally {
    restore();
  }
  return calls;
}

/**
 * The same, for a surface whose face appears only after an awaited step (a
 * data fetch resolved through a mock, a `findBy…`). The instruments stay in
 * place for the whole awaited body and are restored in `finally` either way.
 */
export async function recordLocaleArgumentsAsync(body: () => Promise<void>): Promise<LocaleCall[]> {
  const calls: LocaleCall[] = [];
  const restore = install(calls);
  try {
    await body();
  } finally {
    restore();
  }
  return calls;
}

/**
 * A call that formats in the machine's locale: nothing passed, `undefined`
 * passed, or the `'default'` pseudo-tag passed (see the module doc).
 */
export const isMachineLocale = (c: LocaleCall): boolean =>
  c.argc === 0 || c.locale === undefined || c.locale === 'default';
