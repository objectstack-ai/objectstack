/**
 * Declarative local patches for the regenerated Shadcn primitives.
 *
 * ## Why this file exists
 *
 * `packages/components/src/ui/**` is a No-Touch zone (AGENTS.md Commandment
 * #7): every file in it is overwritten by `pnpm shadcn:update` from the
 * upstream registry. That is fine for the 99% of those files we take as-is,
 * and `shadcn-sync.js` already protects hand edits *defensively* — it counts
 * `localOnlyLines` and REFUSES to overwrite a diverged file.
 *
 * Refusal is not enough for a patch that must never silently disappear:
 *
 *   1. `--force` bypasses the refusal by design, and takes the edit with it.
 *   2. A type-check cannot see the loss. Upstream drops a local addition *and*
 *      its usages consistently, so the regenerated file still compiles — this
 *      is the `command.tsx` failure mode documented in `shadcn-sync.js`.
 *   3. Nothing declares WHICH lines were load-bearing, so a reviewer staring
 *      at a post-sync diff has no way to tell a deliberate fix from drift.
 *
 * So the edits that MUST survive regeneration are declared here as data, and
 * the sync script re-applies them on every write. The patch is no longer a
 * hand edit someone has to remember to re-do; it is part of what "sync" means.
 *
 * ## Declared = enforced
 *
 * Every patch carries `marker` (what the patched file must contain) and
 * `find`/`occurrences` (the upstream anchor it needs). That makes three
 * different regressions loud instead of silent:
 *
 *   - `verifyLocalPatches()` — the file on disk lost its marker (a forced
 *     sync, a bad merge, a hand edit). Offline, so it can gate every PR.
 *   - `applyLocalPatches()` on freshly fetched upstream — the anchor is gone
 *     or has moved, i.e. the patch will NOT survive the next regeneration.
 *     `shadcn:check` reports this before anyone runs `--update`.
 *   - `applyLocalPatches()` during `--update` — same, and the write is
 *     refused rather than producing a file with the patch quietly missing.
 *
 * ## Adding a patch
 *
 * Keep the payload OUT of `src/ui/`. A patch should be a one-line reference to
 * code that lives somewhere the sync never touches (here: `src/lib/`), because
 * a small anchored reference survives upstream churn far better than an
 * inlined implementation, and the implementation itself stays reviewable and
 * unit-testable in a normal file.
 *
 * Write `find` from REGISTRY bytes, never from `src/ui/**`. The local file is
 * the patched artefact, so any line an earlier local edit left there reads as a
 * perfectly good anchor: it matches the file in front of you and matches
 * nothing upstream, which makes the patch dead on arrival while looking
 * correct. objectui#4976 is the worked example. The round-trip assertion in
 * `scripts/__tests__/shadcn-local-patches.test.ts` is what holds a new anchor
 * to this rule offline, without a network round-trip.
 */

/**
 * @typedef {object} LocalPatch
 * @property {string}  id          Stable identifier, used in messages.
 * @property {string}  issue       Tracking issue for the divergence.
 * @property {string}  reason      Why this edit exists, in prose.
 * @property {string}  find        Literal upstream anchor (NOT a regex).
 * @property {string}  replace     Literal replacement.
 * @property {string}  marker      Substring that proves the patch is applied.
 * @property {number}  occurrences Exact number of `find` hits expected.
 */

/**
 * The i18n patch, shared by `sheet` and `dialog`.
 *
 * Both primitives auto-render an icon-only close button whose ONLY accessible
 * name is a hardcoded English `sr-only` span, so under zh/ja/es every drawer
 * and modal in the console announced "Close" in English (objectstack#5505).
 *
 * The two patches per file are deliberately the smallest possible edit: add an
 * import, swap one element. All of the actual i18n behaviour — the safe
 * translation hook, the English fallback, the defaults map — lives in
 * `packages/components/src/lib/close-label.tsx`, which the sync never
 * regenerates.
 *
 * @param {string} primitive Human-readable primitive name, for the reason text.
 * @returns {LocalPatch[]}
 */
function i18nCloseLabelPatches(primitive) {
  return [
    {
      id: `${primitive.toLowerCase()}-i18n-close-import`,
      issue: 'objectstack#5505',
      reason:
        `Imports the shared translated close label used by ${primitive}Content's ` +
        'auto-rendered close button. Anchored on the `cn` import, which every ' +
        'Shadcn component carries.',
      find: 'import { cn } from "../lib/utils"',
      replace:
        'import { cn } from "../lib/utils"\nimport { CloseSrLabel } from "../lib/close-label"',
      marker: 'from "../lib/close-label"',
      occurrences: 1,
    },
    {
      id: `${primitive.toLowerCase()}-i18n-close-label`,
      issue: 'objectstack#5505',
      reason:
        `${primitive}Content's close button is icon-only (lucide X), so this ` +
        'sr-only span IS the control\'s accessible name. Upstream hardcodes the ' +
        'English literal; CloseSrLabel resolves `common.close` for the session ' +
        'locale and falls back to "Close" when no I18nProvider is mounted.',
      find: '<span className="sr-only">Close</span>',
      replace: '<CloseSrLabel />',
      marker: '<CloseSrLabel />',
      occurrences: 1,
    },
  ];
}

/**
 * The sidebar collapse-persistence patch (objectui#4234).
 *
 * `SidebarProvider` writes `sidebar_state` on every toggle and never reads it
 * back, so a collapsed sidebar returns expanded after a reload — the cookie is
 * present and correct, and nothing consults it. Upstream closes the loop in a
 * **server component** (read the cookie there, pass it down as `defaultOpen`),
 * a step a pure SPA like the console does not have, so the read must happen
 * client-side inside the provider itself.
 *
 * Fixing it at a call site instead was rejected on the issue: passing a
 * cookie-derived `defaultOpen` from one shell leaves every other SPA consumer
 * of this primitive broken.
 *
 * As with the i18n patches above, the payload stays OUT of `src/ui/`: all of
 * the parsing lives in `packages/components/src/lib/sidebar-cookie.ts`, and the
 * primitive gets two anchored one-liners. The lazy `useState` initialiser (not
 * a mount effect) is the point — the state must be right on the FIRST render,
 * because the reported symptom is measured at first paint and a mount-then-
 * collapse effect would still flash expanded.
 *
 * @type {LocalPatch[]}
 */
const sidebarCookieReadPatches = [
  {
    id: 'sidebar-cookie-read-import',
    issue: 'objectui#4234',
    reason:
      'Imports the cookie reader that restores the persisted collapse state. ' +
      'Anchored on the `cn` import, which every Shadcn component carries.',
    find: 'import { cn } from "../lib/utils"',
    replace:
      'import { cn } from "../lib/utils"\nimport { readSidebarStateCookie } from "../lib/sidebar-cookie"',
    marker: 'from "../lib/sidebar-cookie"',
    occurrences: 1,
  },
  {
    id: 'sidebar-cookie-read-initial-state',
    issue: 'objectui#4234',
    reason:
      "Seeds the provider's uncontrolled state from the `sidebar_state` cookie " +
      'that its own `setOpen` writes, so a collapsed sidebar survives a reload. ' +
      'A lazy initialiser rather than an effect: the value must be correct on ' +
      'the first render, not applied after one expanded paint. Precedence is ' +
      'cookie > `defaultOpen`; the controlled `open` prop still wins, because ' +
      'it is applied downstream of this state (`openProp ?? _open`). ' +
      'SIDEBAR_COOKIE_NAME is passed in so the cookie name keeps exactly one ' +
      'spelling — the write side\'s.',
    find: 'const [_open, _setOpen] = React.useState(defaultOpen)',
    replace:
      'const [_open, _setOpen] = React.useState(() => readSidebarStateCookie(SIDEBAR_COOKIE_NAME) ?? defaultOpen)',
    marker: 'readSidebarStateCookie(SIDEBAR_COOKIE_NAME)',
    occurrences: 1,
  },
];

/**
 * The sidebar optional-context patch (objectui#10859, batch 8 phase 2d).
 *
 * `useSidebar()` THROWS outside a `SidebarProvider`, and the context it reads
 * is module-private, so nothing outside this file can ask the one question the
 * SDUI `sidebar` node needs answered before it renders: "is a provider already
 * above me?". The seat's fork ruling on objectui#10859 has the `sidebar`
 * registration supply its own provider only when none is present, and forbids
 * shadowing a host's provider (the app shell mounts one through
 * `@object-ui/layout`'s `AppShell`). A thrown error is not a usable answer — a
 * try/catch around a hook is not a React pattern, and an error boundary would
 * render the failure before recovering.
 *
 * So the primitive gains a non-throwing sibling of `useSidebar`, which answers
 * `null` exactly where `useSidebar` would throw, and exports it. The payload is
 * one `React.useContext` line: it has to live in this file because the context
 * does, which is the one reason this patch is not a reference into `src/lib/`
 * like the cookie patch above. Anchors are registry bytes (the `useSidebar`
 * body's tail and the export block's last entry), held offline by
 * `scripts/__tests__/shadcn-local-patches.test.ts`.
 *
 * @type {LocalPatch[]}
 */
const sidebarOptionalContextPatches = [
  {
    id: 'sidebar-optional-context-reader',
    issue: 'objectui#10859',
    reason:
      'Adds `useOptionalSidebar()`, a non-throwing read of the provider context: ' +
      '`null` where `useSidebar()` would throw. The SDUI `sidebar` registration ' +
      'reads it to supply a `SidebarProvider` only when no host provider is ' +
      'above it, so a host provider is never shadowed.',
    find: '  return context\n}\n\nconst SidebarProvider = React.forwardRef<',
    replace:
      '  return context\n}\n\n' +
      'function useOptionalSidebar() {\n  return React.useContext(SidebarContext)\n}\n\n' +
      'const SidebarProvider = React.forwardRef<',
    marker: 'function useOptionalSidebar() {\n  return React.useContext(SidebarContext)\n}',
    occurrences: 1,
  },
  {
    id: 'sidebar-optional-context-export',
    issue: 'objectui#10859',
    reason:
      'Exports `useOptionalSidebar` beside `useSidebar`, so the renderer in ' +
      '`src/renderers/navigation/sidebar.tsx` can import it through `../../ui`.',
    find: '  useSidebar,\n}',
    replace: '  useSidebar,\n  useOptionalSidebar,\n}',
    marker: '  useOptionalSidebar,\n}',
    occurrences: 1,
  },
];

/**
 * The sidebar offcanvas state-qualifier patches (objectui#11464).
 *
 * Upstream renders `data-collapsible={state === "collapsed" ? collapsible : ""}`:
 * the attribute is blank while the sidebar is expanded, so a rule keyed on
 * `group-data-[collapsible=offcanvas]:` can only ever match a COLLAPSED sidebar,
 * and upstream writes those rules unqualified.
 *
 * objectui's copy keeps the attribute in every state (the undeclared
 * systematic local edit (3) in `packages/components/shadcn-components.json`),
 * and qualified the `icon` rules with `group-data-[state=collapsed]:` to keep
 * upstream's result. The offcanvas rules were left unqualified, so they matched
 * the expanded state too: an expanded offcanvas panel was pushed one
 * sidebar-width off the edge it is anchored to, out of the viewport, its gap
 * collapsed to `w-0`, and its rail took the collapsed styling. The SDUI `sidebar` node reaches this with `collapsible` omitted or
 * `true`, and `@object-ui/layout`'s `SidebarNav` with `collapsible="offcanvas"`.
 *
 * Each patch qualifies one upstream line by the collapsed state. The
 * `group-data-*` rules take the `group-data-[state=collapsed]:` prefix the
 * `icon` rules already carry. The rail's two arbitrary-selector rules take
 * `[data-state=collapsed]` inside the selector, the spelling the rail's
 * collapsed cursor rules beside them already use. On upstream bytes, where the
 * attribute is blank while expanded, every qualifier is redundant, so the
 * patched registry file draws exactly what upstream draws.
 *
 * Declared rather than typed into `src/ui/` so that a sync that ports edit (3)
 * onto new upstream bytes carries the qualifiers with it. The payload is inline
 * for the reason the sheet family gives: it IS the class list, with nothing to
 * host in `src/lib/`. Every `find` is a whole quoted class string written from
 * `scripts/__tests__/fixtures/shadcn-registry/sidebar.registry.txt`, and every
 * `marker` is the whole patched string, so the shipped file has to carry the
 * payload byte for byte. Chromium measures the result in
 * `e2e/sidebar-offcanvas-geometry.spec.ts`.
 *
 * @type {LocalPatch[]}
 */
const sidebarOffcanvasStateQualifierPatches = [
  {
    find: '"group-data-[collapsible=offcanvas]:w-0",',
    replace: '"group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:w-0",',
    id: 'sidebar-offcanvas-gap-collapsed-only',
    reason:
      "Zeroes the gap (the in-flow spacer that reserves the panel's width beside " +
      'the page) only when the sidebar is collapsed. Unqualified, an expanded ' +
      'offcanvas sidebar reserved no width.',
  },
  {
    find: '"left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"',
    replace:
      '"left-0 group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"',
    id: 'sidebar-offcanvas-left-offset-collapsed-only',
    reason:
      'Moves a `side="left"` panel off the left edge only when the sidebar is ' +
      'collapsed. Unqualified, an expanded one was drawn off the left edge.',
  },
  {
    find: '"right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]"',
    replace:
      '"right-0 group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]"',
    id: 'sidebar-offcanvas-right-offset-collapsed-only',
    reason:
      'Moves a `side="right"` panel off the right edge only when the sidebar is ' +
      'collapsed. Unqualified, an expanded one was drawn past the right edge.',
  },
  {
    find:
      '"group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full ' +
      'group-data-[collapsible=offcanvas]:hover:bg-sidebar",',
    replace:
      '"group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:translate-x-0 ' +
      'group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:after:left-full ' +
      'group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:hover:bg-sidebar",',
    id: 'sidebar-offcanvas-rail-collapsed-only',
    reason:
      "Gives the rail its collapsed-edge styling (no centring translate, the hover " +
      'line at its outer edge, a hover fill) only when the sidebar is collapsed.',
  },
  {
    find: '"[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",',
    replace: '"[[data-side=left][data-state=collapsed][data-collapsible=offcanvas]_&]:-right-2",',
    id: 'sidebar-offcanvas-rail-left-edge-collapsed-only',
    reason:
      "Pulls a `side=\"left\"` rail in to the collapsed panel's edge only when the " +
      'sidebar is collapsed.',
  },
  {
    find: '"[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",',
    replace: '"[[data-side=right][data-state=collapsed][data-collapsible=offcanvas]_&]:-left-2",',
    id: 'sidebar-offcanvas-rail-right-edge-collapsed-only',
    reason:
      "Pulls a `side=\"right\"` rail in to the collapsed panel's edge only when the " +
      'sidebar is collapsed.',
  },
].map(({ find, replace, id, reason }) => ({
  id,
  issue: 'objectui#11464',
  reason,
  find,
  replace,
  // The whole patched string: the shipped file must carry the payload exactly.
  marker: replace,
  occurrences: 1,
}));

/**
 * Upstream's thumb class list, spelled exactly once.
 *
 * The delivery patch below has to name it twice — the single-line element it
 * matches and the expanded element it writes back — and a list this long is
 * precisely the kind of string that drifts one character between two copies. One
 * spelling means the anchor and its replacement cannot disagree, the same reason
 * SIDEBAR_COOKIE_NAME is passed into the sidebar patch rather than retyped.
 */
const UPSTREAM_THUMB_CLASSNAME =
  'block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

/**
 * The slider thumb pass-through patch (objectui#3318).
 *
 * A Radix slider's focusable control is the THUMB (`span[role="slider"]`,
 * `tabindex="0"`) — the element a keyboard user lands on and the one assistive
 * technology reads state from. `Slider.Root` renders a role-less wrapper span
 * and takes every unrecognised prop, so a host's `id` / `aria-invalid` /
 * `aria-describedby` / `aria-labelledby` landed on a wrapper nobody visits:
 * a required slider showed its red message with nothing announced, its visible
 * label pointed `for` at an id no element carried, and its help text had zero
 * consumers.
 *
 * The primitive exports only `Slider`, so unlike `SelectTrigger` (objectui#3306,
 * the same defect one step easier) a widget has NO handle on the element that
 * must carry those facts. Hence a declared `thumbProps`.
 *
 * Four patches. Three are one-liners; the delivery half expands upstream's
 * single-line self-closing Thumb into the multi-line form that can carry the
 * routed props. As with the families above, the payload stays OUT of
 * `src/ui/`: the routing and its reasoning live in
 * `packages/components/src/lib/slider-thumb.ts`.
 *
 * The root half is patched too, and that is not optional: leaving `thumbProps`
 * in Root's spread would stringify it onto the wrapper (`thumbprops="[object
 * Object]"`), the exact leak objectui#3291 sweeps for.
 *
 * ## The delivery anchor was re-targeted once (objectui#4976)
 *
 * As first declared, the delivery patch anchored the line that forwarded the
 * host's accessible name onto the thumb — a line objectui added by hand in
 * commit a014bc00c ("fix Slider accessibility", 2026-04-13), NOT a line the
 * registry has ever served. Upstream renders the thumb with a className and
 * nothing else, and slider's own `localEdits` entry in `shadcn-components.json`
 * said exactly that the whole time. So the anchor matched the file on disk and
 * could never match upstream: the first `--check` after it landed reported the
 * patch unappliable (`found 0x`) while the shipped file was perfectly correct.
 *
 * Re-targeting it moved the anchor only — the payload, and therefore every byte
 * of the shipped primitive's behaviour, is untouched.
 *
 * @type {LocalPatch[]}
 */
const sliderThumbPassThroughPatches = [
  {
    id: 'slider-thumb-import',
    issue: 'objectui#3318',
    reason:
      'Imports the router that splits a Slider\'s props between its Root wrapper ' +
      'and its focusable thumb. Anchored on the `cn` import, which every Shadcn ' +
      'component carries.',
    find: 'import { cn } from "../lib/utils"',
    replace:
      'import { cn } from "../lib/utils"\nimport { splitSliderThumbProps, type SliderThumbPassThrough } from "../lib/slider-thumb"',
    marker: 'from "../lib/slider-thumb"',
    occurrences: 1,
  },
  {
    id: 'slider-thumb-props-type',
    issue: 'objectui#3318',
    reason:
      'Declares `thumbProps` on the wrapper so addressing the focusable control ' +
      'is type-checked rather than cast through `any` (AGENTS.md #6). Additive: ' +
      'every existing call site keeps the exact prop surface it had.',
    find: '  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>\n>',
    replace:
      '  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & SliderThumbPassThrough\n>',
    marker: '& SliderThumbPassThrough',
    occurrences: 1,
  },
  {
    id: 'slider-thumb-root-split',
    issue: 'objectui#3318',
    reason:
      'Withholds `thumbProps` from the Root spread. Without this the object is ' +
      'String()-ed onto the wrapper span as `thumbprops="[object Object]"` — the ' +
      'leak class objectui#3291 sweeps for.',
    find: '    {...props}\n  >',
    replace: '    {...splitSliderThumbProps(props).root}\n  >',
    marker: 'splitSliderThumbProps(props).root',
    occurrences: 1,
  },
  {
    id: 'slider-thumb-aria-delivery',
    issue: 'objectui#3318',
    reason:
      'Delivers the host\'s control-channel facts to the element that can carry ' +
      'them. Upstream renders the thumb with a class list and nothing else, so ' +
      'this is the only route to the focusable span — hence the anchor expands ' +
      'the self-closing element instead of replacing an attribute on it. The ' +
      'spread sits after `className`, the precedence the shipped primitive ' +
      'already gives the routed props. Re-targeted in objectui#4976: the first ' +
      'anchor named a local-only line, so it never matched a registry response.',
    find: `    <SliderPrimitive.Thumb className="${UPSTREAM_THUMB_CLASSNAME}" />\n`,
    replace:
      '    <SliderPrimitive.Thumb\n' +
      `      className="${UPSTREAM_THUMB_CLASSNAME}"\n` +
      '      {...splitSliderThumbProps(props).thumb}\n' +
      '    />\n',
    marker: 'splitSliderThumbProps(props).thumb',
    occurrences: 1,
  },
];

/**
 * The sheet `hideOverlay` patch (objectui#6090).
 *
 * `SheetContent` renders `<SheetOverlay />` unconditionally upstream, which
 * dims and pointer-blocks everything behind the drawer. A non-modal sheet —
 * one whose host page must stay clickable while it is open — needs the
 * backdrop suppressed, so objectui added an optional `hideOverlay` prop.
 *
 * ## Why this is declared rather than left as a documented hand edit
 *
 * It was a hand edit for months, recorded only in `shadcn-components.json`,
 * and objectui#6090 measured what that actually bought: nothing. The
 * protection it was credited with was a type error at the call sites a
 * `--force` sync would break — and there are no call sites in this repo (still
 * none, re-measured on `main` at 0c282d979). `hideOverlay` is OPTIONAL, so a
 * sync that dropped it would type-check clean and the prop would vanish
 * silently.
 *
 * `@object-ui/components` is PUBLISHED, though, so "no call sites" is a
 * statement about this repository and not about the population that would
 * break. Retiring the prop on the strength of an in-repo grep would be a
 * breaking change to a published API justified by evidence that cannot see its
 * own consumers. Declaring it instead makes the loss loud regardless of
 * whether a consumer exists — which is the property the type-check gate was
 * wrongly credited with, now held by `verifyLocalPatches` and by the round-trip
 * assertion in `scripts/__tests__/shadcn-local-patches.test.ts`.
 *
 * ## Why the payload is inline here, unlike every family above
 *
 * The families above deliberately keep their payload out of `src/ui/**` and
 * anchor a one-line reference to `src/lib/`. That is not available here and not
 * being skipped: the payload IS the primitive's own prop surface — an optional
 * member on `SheetContentProps`, its destructuring, and the conditional it
 * guards. There is no implementation to host elsewhere. What the rule is really
 * protecting against — a large inlined body that upstream churn will shred — is
 * absent: three anchors, each one line, all of them structural lines of
 * `SheetContent` rather than incidental formatting.
 *
 * All three `find` strings were written from the vendored registry bytes in
 * `scripts/__tests__/fixtures/shadcn-registry/sheet.registry.txt`, not from the
 * shipped file (objectui#4976 is what happens otherwise), and the round-trip
 * assertion holds them to it.
 *
 * @type {LocalPatch[]}
 */
const sheetHideOverlayPatches = [
  {
    id: 'sheet-hide-overlay-prop',
    issue: 'objectui#6090',
    reason:
      'Declares the optional `hideOverlay` prop on SheetContentProps. Anchored ' +
      "on upstream's empty interface body `{}`, which is what makes the prop " +
      'visible to consumers of the published package at all — drop it and every ' +
      'external `hideOverlay` call site becomes a type error.',
    find: '    VariantProps<typeof sheetVariants> {}',
    replace: '    VariantProps<typeof sheetVariants> {\n  hideOverlay?: boolean\n}',
    marker: 'hideOverlay?: boolean',
    occurrences: 1,
  },
  {
    id: 'sheet-hide-overlay-destructure',
    issue: 'objectui#6090',
    reason:
      'Withholds `hideOverlay` from the `...props` spread that lands on ' +
      'SheetPrimitive.Content. Without this half the prop is forwarded to the ' +
      'DOM as `hideoverlay="true"` (React unknown-attribute leak) AND the ' +
      'conditional below has nothing to read.',
    find: '>(({ side = "right", className, children, ...props }, ref) => (',
    replace: '>(({ side = "right", className, children, hideOverlay, ...props }, ref) => (',
    marker: 'children, hideOverlay, ...props',
    occurrences: 1,
  },
  {
    id: 'sheet-hide-overlay-conditional',
    issue: 'objectui#6090',
    reason:
      'The behaviour itself: skip the dimming, pointer-blocking backdrop when ' +
      'the host asked for a non-modal sheet. Upstream renders SheetOverlay ' +
      'unconditionally, so this is the only line that can honour the prop.',
    find: '    <SheetOverlay />\n',
    replace: '    {!hideOverlay && <SheetOverlay />}\n',
    marker: '{!hideOverlay && <SheetOverlay />}',
    occurrences: 1,
  },
];

/**
 * The calendar display-locale patch (objectui#10722).
 *
 * `Calendar` mounts react-day-picker's `DayPicker`, which spells its month
 * caption and weekday heads, and picks the first day of the week, from a
 * date-fns `Locale` OBJECT. Upstream passes none, so every `Calendar` read
 * date-fns `enUS` under every display locale and every UI language: the
 * form calendar, both date pickers, `CalendarView`'s header popover and
 * `DashboardFilterBar` alike. `useDisplayLocale()` hands out a BCP-47 TAG,
 * and nothing turned one into the other.
 *
 * As with the families above, the payload stays OUT of `src/ui/`: resolving the
 * tag to a `Locale`, and loading it lazily, live in
 * `packages/components/src/lib/date-fns-locale.ts`. The primitive gets an
 * import, the `localeTag` input and a two-line default. The default is placed
 * BEFORE the `{...props}` spread, so a `locale` a caller passes still wins.
 *
 * A caller that formats its other dates with a tag of its own names it through
 * the `localeTag` input (objectui#10747), and the hook resolves that tag in
 * place of the display locale. `CalendarView`'s header popover is the caller
 * that needed it: its grids read the authored `locale`, and a date-fns `Locale`
 * object is something `plugin-calendar` cannot build without a date-fns
 * dependency and a second resolver. The input's type and its documentation live
 * beside the resolver, so the patch names it and nothing more.
 *
 * Every `find` string was written from the vendored registry bytes in
 * `scripts/__tests__/fixtures/shadcn-registry/calendar.registry.txt`.
 *
 * @type {LocalPatch[]}
 */
const calendarDisplayLocalePatches = [
  {
    id: 'calendar-display-locale-import',
    issue: 'objectui#10722',
    reason:
      'Imports the hook that turns the display locale, or the `localeTag` a caller ' +
      'passes (objectui#10747), into the date-fns `Locale` DayPicker reads, and the ' +
      "type that declares that input. Anchored on the `cn` import, which every Shadcn " +
      'component carries.',
    find: 'import { cn } from "../lib/utils"',
    replace:
      'import { cn } from "../lib/utils"\n' +
      'import { useDisplayDateLocale, type CalendarLocaleTagProps } from "../lib/date-fns-locale"',
    marker: 'from "../lib/date-fns-locale"',
    occurrences: 1,
  },
  {
    id: 'calendar-locale-tag-input',
    issue: 'objectui#10747',
    reason:
      'Declares the `localeTag` input, a BCP-47 tag, and takes it out of `props` so it ' +
      'is not spread onto DayPicker. Anchored on the Calendar signature, which ' +
      'CalendarDayButton does not share (its props are `DayButton`\'s).',
    find:
      '  components,\n  ...props\n}: React.ComponentProps<typeof DayPicker> & {\n',
    replace:
      '  components,\n  localeTag,\n  ...props\n}: React.ComponentProps<typeof DayPicker> & CalendarLocaleTagProps & {\n',
    marker:
      '  localeTag,\n  ...props\n}: React.ComponentProps<typeof DayPicker> & CalendarLocaleTagProps & {',
    occurrences: 1,
  },
  {
    id: 'calendar-display-locale-default',
    issue: 'objectui#10722',
    reason:
      "Gives DayPicker the date-fns `Locale` of the caller's `localeTag` when it names " +
      "one (objectui#10747), and of the display locale otherwise, so its caption, weekday " +
      'heads and week start follow the session instead of `enUS`. It is the first ' +
      'attribute and `{...props}` is spread last, so a `locale` the caller passes wins. ' +
      "Anchored on the Calendar body's return, which CalendarDayButton does not share.",
    find: '  const defaultClassNames = getDefaultClassNames()\n\n  return (\n    <DayPicker\n',
    replace:
      '  const defaultClassNames = getDefaultClassNames()\n' +
      '  const displayDateLocale = useDisplayDateLocale(localeTag)\n\n' +
      '  return (\n    <DayPicker\n      locale={displayDateLocale}\n',
    // Both halves in one marker: the tag reaching the hook, and the hook's answer
    // reaching DayPicker. Either one missing reads as the patch missing.
    marker:
      'useDisplayDateLocale(localeTag)\n\n  return (\n    <DayPicker\n      locale={displayDateLocale}',
    occurrences: 1,
  },
];

/**
 * Component name (as tracked in `shadcn-components.json`) → patches it needs.
 *
 * @type {Record<string, LocalPatch[]>}
 */
export const LOCAL_PATCHES = {
  sheet: [...i18nCloseLabelPatches('Sheet'), ...sheetHideOverlayPatches],
  dialog: i18nCloseLabelPatches('Dialog'),
  sidebar: [
    ...sidebarCookieReadPatches,
    ...sidebarOptionalContextPatches,
    ...sidebarOffcanvasStateQualifierPatches,
  ],
  slider: sliderThumbPassThroughPatches,
  calendar: calendarDisplayLocalePatches,
};

/** Components that carry at least one declared patch. */
export function patchedComponents() {
  return Object.keys(LOCAL_PATCHES);
}

/** Count non-overlapping literal occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * Re-apply every declared patch for `name` to `content`.
 *
 * Idempotent: a patch whose `marker` is already present is reported as
 * `already` and the content is left alone, so running this over an
 * already-patched local file is a no-op rather than a double application.
 *
 * A patch whose marker is absent AND whose anchor does not appear exactly
 * `occurrences` times is a HARD failure — it means upstream restructured the
 * code the patch depends on. Callers must refuse to write in that case: a
 * silently-unapplied patch is precisely the regression this module exists to
 * prevent.
 *
 * @param {string} name    Component name, e.g. `sheet`.
 * @param {string} content File content to patch.
 * @returns {{ content: string, applied: LocalPatch[], already: LocalPatch[],
 *             failed: Array<LocalPatch & { found: number }> }}
 */
export function applyLocalPatches(name, content) {
  const patches = LOCAL_PATCHES[name] || [];
  const applied = [];
  const already = [];
  const failed = [];
  let out = content;

  for (const patch of patches) {
    if (out.includes(patch.marker)) {
      already.push(patch);
      continue;
    }

    const found = countOccurrences(out, patch.find);
    if (found !== patch.occurrences) {
      // Anchor gone or duplicated. Either way we must not guess: applying a
      // patch to the wrong place is worse than refusing to apply it.
      failed.push({ ...patch, found });
      continue;
    }

    out = out.split(patch.find).join(patch.replace);
    applied.push(patch);
  }

  return { content: out, applied, already, failed };
}

/**
 * Which declared patches are MISSING from `content`.
 *
 * Pure string containment against `marker`, so this needs no network and no
 * registry access — it is the check that can run on every PR and catch a
 * patch that was reverted by a forced sync, a bad merge or a hand edit.
 *
 * @param {string} name
 * @param {string} content
 * @returns {LocalPatch[]} empty when the file carries every declared patch
 */
export function verifyLocalPatches(name, content) {
  return (LOCAL_PATCHES[name] || []).filter((patch) => !content.includes(patch.marker));
}

/**
 * Human-readable explanation of a violated or unappliable patch.
 *
 * Shared by the sync script's several failure paths so the operator always
 * gets the id, the tracking issue and the reason — not just "something
 * changed".
 *
 * @param {string} name
 * @param {LocalPatch & { found?: number }} patch
 * @returns {string[]} lines to print
 */
export function describePatchFailure(name, patch) {
  const lines = [
    `  [${patch.id}] declared for ${name}.tsx (${patch.issue})`,
    `    why: ${patch.reason}`,
  ];
  if (typeof patch.found === 'number') {
    lines.push(
      `    anchor expected ${patch.occurrences}x, found ${patch.found}x: ${JSON.stringify(patch.find)}`,
    );
  } else {
    lines.push(`    missing marker: ${JSON.stringify(patch.marker)}`);
  }
  return lines;
}
