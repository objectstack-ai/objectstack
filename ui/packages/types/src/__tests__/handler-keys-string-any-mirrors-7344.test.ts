/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The 8 `on*` handler keys that PR #7339's census could not see — four
 * declared the handler-expression STRING dialect (`z.string()`), three declared
 * `z.any()`, one declared `z.function()` in a multi-line spelling — now REFUSE
 * BY NAME (objectui#7344).
 *
 * ## The rulings this executes
 *
 *   - objectui#6182 (maintainer, 2026-08-25, batch 4, 「同意」, option A): the
 *     handler-expression string dialect is NOT a supported authoring form, on
 *     either face. Its consequence clause sends the `z.string()` handler mirrors
 *     into objectui#6124's per-key sweep "with the same treatment".
 *   - objectui#6124 (maintainer, 2026-08-30, 「批次 #8 同意」; PR #7339): the
 *     treatment's SHAPE. zod face: a named refusal arm (`handlerKeyRefusal`,
 *     `../zod/tombstone.zod.ts`), no expression arm, no declarative-object arm.
 *     TypeScript face, measured per key: a function type only where a runtime
 *     consumer reads the key as a function, else `?: never`.
 *
 * ## Why #7339 missed these
 *
 * Its census anchored on `on*: z.function(` — one line, one spelling. The four
 * `z.string()` sites and the three `z.any()` sites never matched; the eighth,
 * `CalendarViewSchema.onEventClick`, WAS `z.function()` but spelled over three
 * lines (`z` ⏎ `.function()` ⏎ `.optional()`). Two of the three families were
 * worse than the one #7339 fixed: an authored string parsed GREEN on all seven
 * (the mirror was WIDER than the declaration — objectui#7069's direction) and
 * then reached a slot that calls it, throwing `onBack is not a function` at
 * click (the objectui#4453 shape: an authored string handler that runs nothing
 * and is refused nowhere).
 *
 * ## Per-key measurement (the TypeScript disposition), on `origin/main` @ `d88e20f55`
 *
 * RUNTIME SLOT — a host-supplied function REACHES a renderer:
 *   - `views.zod.ts#DetailViewSchema.onBack` — `detail-view`'s registration
 *     (`plugin-detail/src/index.tsx`) spreads the node's keys onto `DetailView`
 *     (`{...props}` after `SchemaRenderer`'s `...componentProps`), whose
 *     `handleBack` CALLS `onBack()` when set (`DetailView.tsx`). The TS twin
 *     declared `string`; the consumer's own prop is `() => void`, so the twin
 *     now declares what the renderer invokes.
 *   - `crud.zod.ts#DetailSchema.onBack` — `ComponentRegistry.register('detail',
 *     DetailView)` (`plugin-detail/src/index.tsx`), the same `handleBack`.
 *   - `crud.zod.ts#DetailSchema.onNavigate` and `.onAddComment` — objectui#7804,
 *     added on the batch #69 ruling. ⚠️ They do NOT belong to this file's
 *     origin story: neither was ever `z.string()` or `z.any()`, so #7339's
 *     anchor could not have missed them — they were declared on NEITHER face,
 *     which is why `.passthrough()` KEPT them and the repo gate
 *     `check:handler-key-reads` carried them as `KNOWN_UNDECLARED_READS` rows.
 *     They are ledgered here because this file owns the `crud.zod.ts#DetailSchema`
 *     pair, and its per-key assertions are exactly what they need.
 *     Measured per key, and the two channels are NOT the same one:
 *       - `onNavigate` — `DetailView` reads it in its OWN body and CALLS it
 *         (`handleBack`, `handleEdit`, the post-delete redirect). The `'detail'`
 *         registration is the RAW component, so the authored value arrives by
 *         identity with nothing interposed.
 *       - `onAddComment` — `DetailView` never calls it; it FORWARDS it as a
 *         React prop into `<RecordComments>`, whose submit handler awaits it,
 *         behind a `schema.comments` gate that the same passthrough keeps alive.
 *     Both driven through the real `SchemaRenderer` in
 *     `plugin-detail/src/__tests__/detail-handler-slots-7804.test.tsx`, where
 *     the base reading was: an authored `{ action: 'toast' }` parsed GREEN on
 *     both keys and survived into the parsed output, while `onBack` — the lit
 *     control on the same arm — was refused.
 *   - `crud.zod.ts#ActionSchema.onClick` — `ActionRunner.ts` `await
 *     action.onClick()` (two sites); `action-menu.tsx`, `containers.tsx`,
 *     `record-quick-actions.tsx` all `typeof action.onClick === 'function'`.
 *   - `complex.zod.ts#CalendarViewSchema.onEventClick` — `calendar-view`'s
 *     `pickHostCallbacks` forwards it when it is a function
 *     (`calendar-view-renderer.tsx`), the sibling of `onViewChange`'s arm.
 *
 * RETIRED — nothing reads the KEY (`?: never` on the TypeScript face). ⚠️ The
 * subject is the KEY, never the array it sits in. This entry used to read
 * "`AppComponentSchema.actions[]` has no reader in `@object-ui/layout`,
 * `@object-ui/app-shell` or the console" — literally true, and true ONLY
 * because of that hand-written three-package scope; `@object-ui/runner` was
 * outside it and reads the array. Stripped of the scope it became the flat
 * "nothing reads `AppComponentSchema.actions[]`" that the objectui#7344
 * changeset was about to publish as `@object-ui/types` CHANGELOG copy
 * (objectui#7721). Re-measured whole-tree:
 *   - `app.zod.ts#AppActionSchema.onClick` — LEFT THIS LEDGER with objectui#7469
 *     (maintainer ruling C), which retired `AppComponentSchema.actions`,
 *     `AppAction` and `AppActionSchema` on both faces and deleted the runner's
 *     rendering of the array. The key went with the whole element schema, so
 *     this is not a reclassification in place. What this entry measured before
 *     that: the array WAS read, by exactly one package (`@object-ui/runner`'s
 *     `LayoutRenderer`), and `onClick` was not. The reader census below now
 *     asserts the retirement's other half: NOTHING reads the array, with the
 *     same population controls.
 *   - `reports.zod.ts#ReportBuilderSchema.onSave` / `.onCancel` — no renderer is
 *     registered for `report-builder` (control on the same tree:
 *     `register('detail-view'` and `register('report-designer'` both resolve).
 *   - `crud.zod.ts#CRUDDialogSchema.onClose` — no renderer is registered for
 *     `crud-dialog`; zero references to `CRUDDialogSchema` outside
 *     `packages/types` and the docs index.
 *
 * NONE read the key as a STRING and dispatched it — the third class the card
 * reserved for the decision box did not occur on this tree.
 *
 * ## Excluded by ruling, verified by describe text
 *
 * `views.zod.ts` still declares three `on*: z.string()` keys — `onViewChange`
 * (`ViewSwitcherSchema`), `onChange` (`FilterUISchema`), `onChange`
 * (`SortUISchema`). They are event NAMES dispatched on `window` (PR #6899), not
 * handler expressions; each `.describe()` says so verbatim, and the census below
 * pins that wording as the reason the three survive the anchor.
 *
 * ## The engine the `git grep` census requires (objectui#8361)
 *
 * The reader census below shells out to `git grep`, and every one of its
 * anchors uses `\b` (two also use `\s`). POSIX ERE defines NEITHER: GNU regex
 * adds them as extensions, the BSD regex library Apple Git links against does
 * not. Under `-E` that difference is silent and total — on a stock macOS host
 * every anchor matched nothing, the census read a tree with zero readers, and
 * all five assertions failed saying "the anchor is dead", which sent a reader
 * hunting for a tree change that had not happened. CI, on Linux, was green on
 * the same bytes.
 *
 * So the anchors run through `-P` (PCRE, which has `\b` on both hosts), and the
 * `engine self-test` describe below is the VERIFIER of that choice rather than
 * an assumption about it: it probes a synthetic corpus in a temp dir and fails,
 * naming the git it ran on, if that git has no PCRE or if its `\b` is not a
 * word boundary. `gitGrepFiles` was hardened in the same direction — only exit
 * 1 ("no matches") is still read as a reading; any other status is reported as
 * the TOOL failing instead of being laundered into an empty census.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * On the unmodified tree (`origin/main` @ `d88e20f55`):
 *   - the single-line census finds 10 sites, not the 3 event-name keys; the
 *     multi-line census finds 1 (`complex.zod.ts` `onEventClick`), not 0;
 *   - no site carries the objectui#6124 guidance in its description;
 *   - an authored STRING parses GREEN on the seven `z.string()` / `z.any()`
 *     sites and is refused with `invalid_type` (not `custom`) on `onEventClick`;
 *   - a live function parses GREEN on the `z.any()` three and on `onEventClick`,
 *     and is refused with `invalid_type` on the `z.string()` four;
 *   - the whole-document counter-probe parses `onBack: 'goBack'` GREEN;
 *   - `tsc -p tsconfig.test.json` reports TS2344 on every `RetiredIsNever` and
 *     `StringIsGone` line, and on `KeepsFunction<DetailViewSchema['onBack']>`.
 * The `{}`-parses-green probes and the instrument controls are GREEN before and
 * after — they pin the instrument, not this change.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { CalendarViewSchema as CalendarViewZod } from '../zod/complex.zod';
import {
  ActionSchema as ActionZod,
  CRUDDialogSchema as CRUDDialogZod,
  DetailSchema as DetailZod,
} from '../zod/crud.zod';
import { ReportBuilderSchema as ReportBuilderZod } from '../zod/reports.zod';
import {
  DetailViewSchema as DetailViewZod,
  FilterUISchema as FilterUIZod,
  SortUISchema as SortUIZod,
  ViewSwitcherSchema as ViewSwitcherZod,
} from '../zod/views.zod';

import type { CalendarViewSchema } from '../complex';
import type { ActionSchema, CRUDDialogSchema, DetailSchema } from '../crud';
import type { ReportBuilderSchema } from '../reports';
import type { DetailViewSchema } from '../views';

/* ── The census, as data ─────────────────────────────────────────────────── */

type Site = readonly [file: string, schema: string, key: string, mirror: z.ZodType];

/** The object that DECLARES `key` behind a mirror. `crud.zod.ts#ActionSchema`
 *  is a `z.lazy` (its `chain` recurses), so the member lives one `unwrap()`
 *  down; every other mirror here IS the object. Same helper as the #6124 pin. */
const objectOf = (mirror: z.ZodType, key: string): z.ZodObject<z.ZodRawShape> => {
  const inner = mirror instanceof z.ZodLazy ? mirror.unwrap() : mirror;
  const obj = inner as z.ZodObject<z.ZodRawShape>;
  if (!(key in obj.shape)) throw new Error(`mirror does not declare \`${key}\``);
  return obj;
};

/** The six keys whose function value REACHES a renderer (channels above). */
const RUNTIME_SLOT: readonly Site[] = [
  ['views.zod.ts', 'DetailViewSchema', 'onBack', DetailViewZod],
  ['crud.zod.ts', 'ActionSchema', 'onClick', ActionZod],
  ['crud.zod.ts', 'DetailSchema', 'onBack', DetailZod],
  // objectui#7804 — the two keys `DetailView` reads off a `'detail'` document
  // that its arm never declared. They arrive by a DIFFERENT route from the four
  // above (never `z.string()` / `z.any()`, simply absent), and on two different
  // channels from each other; see the docblock's objectui#7804 section.
  ['crud.zod.ts', 'DetailSchema', 'onNavigate', DetailZod],
  ['crud.zod.ts', 'DetailSchema', 'onAddComment', DetailZod],
  ['complex.zod.ts', 'CalendarViewSchema', 'onEventClick', CalendarViewZod],
];

/** The keys NO renderer reads. (`app.zod.ts#AppActionSchema.onClick` left with
 *  its whole schema — objectui#7469; see the docblock.) */
const RETIRED: readonly Site[] = [
  ['reports.zod.ts', 'ReportBuilderSchema', 'onSave', ReportBuilderZod],
  ['reports.zod.ts', 'ReportBuilderSchema', 'onCancel', ReportBuilderZod],
  ['crud.zod.ts', 'CRUDDialogSchema', 'onClose', CRUDDialogZod],
];

const ALL_SITES: readonly Site[] = [...RUNTIME_SLOT, ...RETIRED];

/** The three `on*: z.string()` keys that SURVIVE the census — event names, not
 *  handlers — with the mirror that declares each, so the exclusion is pinned to
 *  its reason (the describe text) and not to a line number. */
const EVENT_NAME_KEYS: readonly Site[] = [
  ['views.zod.ts', 'ViewSwitcherSchema', 'onViewChange', ViewSwitcherZod],
  ['views.zod.ts', 'FilterUISchema', 'onChange', FilterUIZod],
  ['views.zod.ts', 'SortUISchema', 'onChange', SortUIZod],
];
const EVENT_NAME_WORDING = 'an event NAME, not a callback or a handler expression';

const HERE = dirname(fileURLToPath(import.meta.url));
const ZOD_DIR = join(HERE, '..', 'zod');
/** `packages/types/src/__tests__` -> the workspace root. */
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
/** EVERY mirror module — objectui#6182's close condition runs over the whole
 *  directory, not the nine files #7339's census listed (that list is what let
 *  these eight through). */
const MIRROR_FILES = readdirSync(ZOD_DIR)
  .filter((f) => f.endsWith('.zod.ts'))
  .sort();
const readMirror = (file: string) => readFileSync(join(ZOD_DIR, file), 'utf8');

/** objectui#6182's anchor, single-line: the key, then `z.` and one of the three
 *  constructors on the same line. Anchored at line start so the spelling cannot
 *  match mid-identifier (`buttonLabel`, `actionUrl`). */
const ON_KEY_SINGLE_LINE = /^\s*(on[A-Z][A-Za-z]*): z\.(function|string|any)\(/gm;
/** The multi-line spelling that hid `onEventClick`: `on*: z` ending the line,
 *  `.function(` opening the next. */
const ON_KEY_MULTI_LINE_FUNCTION = /^\s*(on[A-Z][A-Za-z]*): z[ \t]*\r?\n\s*\.function\(/gm;
/** Control for the multi-line instrument: the same two-line shape on a NON-handler
 *  key with any constructor (`startDateField: z` ⏎ `.string()`, `buttonVariant: z`
 *  ⏎ `.enum(`). Fires on this tree; a regex that could not see line breaks
 *  would report 0 here too. */
const MULTI_LINE_CONTROL = /^\s*[a-z][A-Za-z]*: z[ \t]*\r?\n\s*\.(enum|string|any|union|number|boolean)\(/gm;

const describeOf = (mirror: z.ZodType, key: string): string | undefined =>
  (objectOf(mirror, key).shape[key] as { description?: string } | undefined)?.description;

/** One key, isolated: `.pick()` keeps the member's own declaration and drops
 *  the rest, so a refusal can only be about the key under test. */
const pickKey = (mirror: z.ZodType, key: string) =>
  objectOf(mirror, key).pick({ [key]: true } as Record<string, true>);

/** The handler-expression string dialect, in the spellings the corpus taught:
 *  a bare handler name (`content/docs/core/report-schema.mdx` `onSave:
 *  'handleSaveReport'`) and an inline call (`examples/schema-catalog`
 *  `onClick: "toast(\"…\")"`). */
const AUTHORED_STRINGS = ['handleSaveReport', 'toast("Hello from ObjectUI!")'] as const;
const AUTHORED_ACTION_OBJECT = { action: 'toast', title: 'Saved', variant: 'success' };
const LIVE_FUNCTION = () => undefined;

/* ── Census: objectui#6182's close condition, both anchors ───────────────── */

describe('census: the only on*: z.(function|string|any) lines left in packages/types/src/zod are the three event-name keys (objectui#6182 close condition)', () => {
  it('the single-line anchor returns exactly the three event-name keys', () => {
    const hits = MIRROR_FILES.flatMap((file) =>
      [...readMirror(file).matchAll(ON_KEY_SINGLE_LINE)].map((m) => `${file}#${m[1]}: z.${m[2]}(`),
    );
    expect(hits.sort()).toEqual([
      'views.zod.ts#onChange: z.string(',
      'views.zod.ts#onChange: z.string(',
      'views.zod.ts#onViewChange: z.string(',
    ]);
  });

  it('the multi-line anchor returns 0, and its control still fires on the same files', () => {
    const hits = MIRROR_FILES.flatMap((file) =>
      [...readMirror(file).matchAll(ON_KEY_MULTI_LINE_FUNCTION)].map((m) => `${file}#${m[1]}`),
    );
    expect(hits).toEqual([]);
    const control = MIRROR_FILES.flatMap((file) =>
      [...readMirror(file).matchAll(MULTI_LINE_CONTROL)].map((m) => `${file}: ${m[0].trim()}`),
    );
    expect(control.length).toBeGreaterThan(0);
  });

  it.each(EVENT_NAME_KEYS)('%s %s.%s survives the anchor BECAUSE its describe text says it is an event name (PR #6899)', (_file, _schema, key, mirror) => {
    expect(describeOf(mirror, key)).toContain(EVENT_NAME_WORDING);
    // Still the string it always was — this card does not touch the three.
    expect(pickKey(mirror, key).safeParse({ [key]: 'view-changed' }).success).toBe(true);
  });

  it('the census read the whole mirror directory, not a hand-listed subset', () => {
    // Every file this card edits is in the population, and so is the one that
    // held the multi-line site. A directory read cannot drift the way #7339's
    // nine-file list did.
    for (const file of ['app.zod.ts', 'complex.zod.ts', 'crud.zod.ts', 'reports.zod.ts', 'views.zod.ts']) {
      expect(MIRROR_FILES).toContain(file);
    }
    expect(MIRROR_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it('9 sites are ledgered, 6 runtime slots + 3 retired, with no key filed twice', () => {
    // 8 at objectui#7344; 10 since objectui#7804 declared the two keys
    // `DetailView` reads off a `'detail'` document undeclared; 9 since
    // objectui#7469 retired `AppActionSchema` WHOLE (maintainer ruling C).
    // ⛔ A ledger GROWS here by a declaration landing, never by a key being
    // reclassified in place — the shrink direction is the failure this family
    // guards. The objectui#7469 shrink is the other kind: the declaring schema
    // left both faces, and `AppComponentSchema.actions`, the array that held it,
    // is a named refusal (`./app-actions-retired-7469.test.ts`).
    expect(RUNTIME_SLOT).toHaveLength(6);
    expect(RETIRED).toHaveLength(3);
    const ids = ALL_SITES.map(([file, schema, key]) => `${file}#${schema}.${key}`);
    expect(new Set(ids).size).toBe(9);
  });

  it.each(ALL_SITES)('%s %s.%s is DECLARED on the mirror shape, with the objectui#6124 guidance as its description', (_file, _schema, key, mirror) => {
    // `.shape`, not `safeParse`: under `.passthrough()` a DELETED key still
    // parses green (the value rides through), so a parse-based declaration pin
    // stays green through the very deletion it exists to catch.
    expect(objectOf(mirror, key).shape[key]).toBeDefined();
    expect(describeOf(mirror, key)).toContain('objectui#6124');
  });
});

/* ── Census: WHO reads `AppComponentSchema.actions[]` (objectui#7721 → #7469) ── */

/** The whole-tree reader set. objectui#7721 measured ONE file in ONE package
 *  (`@object-ui/runner`'s `LayoutRenderer`, on `origin/main` @ `951fa8e0d`) and
 *  held it here as DATA, because a hand-written scope cannot fail when the tree
 *  grows a reader nobody listed. objectui#7469 (maintainer ruling C) retired the
 *  array on both faces and deleted that reader, so the set is now EMPTY — and
 *  the same instrument, with the same population controls, is what keeps it
 *  empty: a renderer that starts reading the refused key again names itself. */
const ACTIONS_READER_FILES = [] as const;
/** The former reader: still in the population (it names `AppComponentSchema`),
 *  no longer a reader. The positive control for the empty set above. */
const FORMER_READER_FILE = 'packages/runner/src/LayoutRenderer.tsx';

/** `packages/types` DECLARES the member and cannot render it (zero deps, no
 *  React — AGENTS.md §3), so it is outside the reader population by
 *  construction, not by convenience. `git grep` reads TRACKED files, so a
 *  literal anchor also matches the two files that merely DESCRIBE the key;
 *  those two are pinned below, so a third matching file inside `packages/types`
 *  still turns this red rather than slipping through the exclusion. Since
 *  objectui#7469 they are this census and the retirement's own pin — `app.ts`
 *  left the set with the `AppAction` docblock that described the old reader. */
const DECLARING_PACKAGE_PREFIX = 'packages/types/';
const DECLARING_PACKAGE_PROSE = [
  'packages/types/src/__tests__/app-actions-retired-7469.test.ts',
  'packages/types/src/__tests__/handler-keys-string-any-mirrors-7344.test.ts',
] as const;

/** Two independent anchors, because a reader can reach the array two ways.
 *  A — it NAMES `AppComponentSchema` and reads some `.actions` (how the one
 *      known reader does it).
 *  B — it reads `.actions` off an app-shaped receiver whatever it imports
 *      (`app.actions`, `appConfig.actions`, …) — how a STRUCTURAL reader that
 *      never mentions the type would surface. B is empty of new names today;
 *      it is here for the tree that grows one. */
const ANCHOR_NAMES_TYPE = 'AppComponentSchema';
const ANCHOR_ACTIONS_READ = '\\.actions\\b';
const ANCHOR_APP_SHAPED_READ = '\\bapp[A-Za-z0-9_$]*\\??\\.actions\\b';
/** The import anchors, named rather than inlined so the `\b`-carries-PCRE pin
 *  below can see the whole anchor set instead of a hand-copied subset. */
const ANCHOR_IMPORTS_APP_ACTION = '^\\s*import[^;]*\\bAppAction\\b';
const ANCHOR_IMPORTS_NAMES_TYPE = '^\\s*import[^;]*\\bAppComponentSchema\\b';
const ANCHOR_MENTIONS_APP_ACTION = '\\bAppAction\\b';
/** Every anchor above that reaches `git grep` as a REGEX (`ANCHOR_NAMES_TYPE`
 *  goes through `-F` and is a literal, so it is not one). */
const REGEX_ANCHORS = [
  ANCHOR_ACTIONS_READ,
  ANCHOR_APP_SHAPED_READ,
  ANCHOR_IMPORTS_APP_ACTION,
  ANCHOR_IMPORTS_NAMES_TYPE,
  ANCHOR_MENTIONS_APP_ACTION,
] as const;

/** ⚠️ POSIX ERE has no `\b` (nor `\s`). GNU regex adds both as extensions; the
 *  BSD regex library Apple Git links against does not — so under `-E` every
 *  anchor above is DEAD on a stock macOS host, and the census reads a tree with
 *  zero readers. That is not a hypothetical: it cost one seat a hunt for a tree
 *  change that never happened (objectui#8361). PCRE knows `\b` on both hosts,
 *  so the anchors run through `-P`, and the engine self-test below is what
 *  turns a git with NO PCRE into a failure that NAMES the engine instead of one
 *  that impersonates an empty tree. */
const GREP_ENGINE_FLAG = '-P';
/** The scanned tree. `examples/` is in it because an example app is exactly
 *  where a fourth reader would plausibly appear. */
const SCAN_ROOTS = ['packages', 'apps', 'examples'] as const;
/** Every `CHANGELOG.md` is outside the scanned tree. `pnpm changeset:version`
 *  writes each pending changeset body into one, and the changeset for a
 *  retirement names the key it retires. Without this exclusion the release
 *  commit itself reads as five new readers of the array, which is what turned
 *  the 17.7.0 release head red (objectui#11586). A CHANGELOG is history, not
 *  code. The sibling censuses exclude it with the same spelling
 *  (`eventable-schema-retired-6497.test.ts`). */
const SCAN_EXCLUDES = [':!*CHANGELOG.md'] as const;

/** The engine, for the diagnostics below: a failure that says "the anchor is
 *  dead" is only actionable if it also says WHICH git read it. */
const gitVersion = (): string => {
  try {
    return execFileSync('git', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'unknown — `git --version` itself failed';
  }
};

/** File paths, relative to the workspace root, over TRACKED files only — an
 *  untracked scratch file or a build artefact cannot move this census. */
const gitGrepFiles = (args: readonly string[]): string[] => {
  type Failure = { status?: number; stdout?: string; stderr?: string };
  let out: string;
  let failure: Failure | undefined;
  try {
    out = execFileSync('git', ['grep', ...args, '--', ...SCAN_ROOTS, ...SCAN_EXCLUDES], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    failure = err as Failure;
    out = failure.stdout ?? '';
  }
  // ⚠️ Exactly ONE non-zero status is a READING: `git grep` exits 1 on "no
  // matches", which here would mean a dead instrument, not an empty tree — fall
  // through and let the emptiness controls below name it. EVERY other status is
  // the TOOL failing (a git built without PCRE dies 128 on `-P`), and
  // laundering that into an empty census is the objectui#8361 shape: an engine
  // difference wearing a tree change's clothes. Raised OUTSIDE the `catch` (and
  // so without an `Error` `cause`, which this package's `lib: ES2020` does not
  // declare) — everything the caught error carried that a reader can act on,
  // its status and its stderr, is quoted into the message instead.
  if (failure && failure.status !== 1) {
    throw new Error(
      `\`git grep ${args.join(' ')}\` exited ${String(failure.status)} — the TOOL failed, `
        + 'this is NOT a reading of an empty tree. '
        + `Engine: ${gitVersion()}, regex flag \`${GREP_ENGINE_FLAG}\`. `
        + `git said: ${(failure.stderr ?? '').trim() || '(nothing on stderr)'}`,
    );
  }
  return out.split('\n').filter(Boolean).sort();
};

const scan = () => {
  const namesType = new Set(gitGrepFiles(['-l', '-F', ANCHOR_NAMES_TYPE]));
  const readsActions = gitGrepFiles(['-l', GREP_ENGINE_FLAG, ANCHOR_ACTIONS_READ]);
  const anchorA = readsActions.filter((f) => namesType.has(f));
  const anchorB = gitGrepFiles(['-l', GREP_ENGINE_FLAG, '-i', ANCHOR_APP_SHAPED_READ]);
  const readers = [...new Set([...anchorA, ...anchorB])]
    .filter((f) => !f.startsWith(DECLARING_PACKAGE_PREFIX))
    .sort();
  return { namesType, readsActions, anchorA, anchorB, readers };
};

/** The owning package, read from its own manifest — never a hand-written map
 *  from path to package name, which is the same kind of hand-written scope this
 *  census exists to retire. */
const packageNameOf = (file: string): string => {
  const [top, dir] = file.split('/');
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, top, dir, 'package.json'), 'utf8'),
  ) as { name: string };
  return manifest.name;
};

/* ── Engine self-test: the flag the census runs through KNOWS `\b` ───────── */

/** A synthetic corpus, written to a temp dir OUTSIDE this repo and read back
 *  through `git grep --no-index`, so the probe measures the ENGINE and nothing
 *  about this tree. The token is deliberately not a word the census searches
 *  for: a probe scoped to its own question cannot be answered by the file it
 *  lives in. */
const ENGINE_PROBE_TOKEN = 'enginepin';
const ENGINE_PROBE_LINES = [
  `alpha ${ENGINE_PROBE_TOKEN} omega`, // 1 — bare word: `\b…\b` MUST match it
  `alpha x${ENGINE_PROBE_TOKEN}x omega`, // 2 — glued: a real boundary must NOT
  `alpha b${ENGINE_PROBE_TOKEN}b omega`, // 3 — glued with the LETTER `b`: an
  //     engine that reads `\b` as a literal `b` matches THIS and not line 1,
  //     so the two negatives separate "no boundary support" from "boundary
  //     read as a character".
] as const;

type EngineProbe = {
  /** 1-based line numbers `\b<token>\b` matched. */
  readonly matched: readonly number[];
  /** `git grep`'s exit status: 0 matched, 1 matched nothing, anything else the
   *  tool failed — a git with no PCRE dies 128 here. */
  readonly status: number | null;
  readonly stderr: string;
};

const probeWordBoundary = (flag: string): EngineProbe => {
  const dir = mkdtempSync(join(tmpdir(), 'objectui-8361-engine-'));
  try {
    writeFileSync(join(dir, 'probe.txt'), `${ENGINE_PROBE_LINES.join('\n')}\n`, 'utf8');
    const argv = [
      'grep', '--no-index', '-n', flag, `\\b${ENGINE_PROBE_TOKEN}\\b`, '--', 'probe.txt',
    ];
    const lines = (out: string): number[] =>
      out.split('\n').filter(Boolean).map((l) => Number(l.split(':')[1]));
    try {
      const out = execFileSync('git', argv, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { matched: lines(out), status: 0, stderr: '' };
    } catch (err) {
      const failure = err as { status?: number; stdout?: string; stderr?: string };
      return {
        matched: lines(failure.stdout ?? ''),
        status: failure.status ?? null,
        stderr: (failure.stderr ?? '').trim(),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('engine self-test: the git regex flag the census runs through has `\\b` (objectui#8361)', () => {
  it(`\`git grep ${GREP_ENGINE_FLAG}\` runs at all on this host — a git with no PCRE fails HERE, naming itself`, () => {
    const probe = probeWordBoundary(GREP_ENGINE_FLAG);
    expect(
      probe.status,
      `\`git grep ${GREP_ENGINE_FLAG}\` could not run. This is the ENGINE, not the tree: `
        + `${gitVersion()} said "${probe.stderr || '(nothing on stderr)'}". A git built without `
        + 'PCRE (`USE_LIBPCRE`) dies here; the census anchors need `\\b`, which POSIX ERE does '
        + 'not have, so `-E` is not a fallback — rebuild or install a git with PCRE',
    ).toBe(0);
  });

  it(`its \`\\b\` is a WORD BOUNDARY, not an unsupported escape and not the letter \`b\``, () => {
    const probe = probeWordBoundary(GREP_ENGINE_FLAG);
    expect(
      [...probe.matched],
      `\`\\b\` did not behave as a word boundary under \`${GREP_ENGINE_FLAG}\` on ${gitVersion()}. `
        + 'Expected only line 1 (the bare word). Line 2 too ⇒ no boundary semantics; line 3 '
        + 'instead ⇒ `\\b` read as the literal letter. Either way every census anchor below is '
        + 'dead and its "the anchor is dead" message is about THIS, not about the tree '
        + '(objectui#8361)',
    ).toEqual([1]);
  });

  it('the probe corpus really contains all three lines — the two negatives are readings, not unvisited absences', () => {
    // A negative from a scan is worth nothing unless the line reached the
    // scanner: exactly the control the census below demands of ITSELF. A
    // literal `-F` search cannot be moved by the regex engine under test.
    const dir = mkdtempSync(join(tmpdir(), 'objectui-8361-corpus-'));
    try {
      writeFileSync(join(dir, 'probe.txt'), `${ENGINE_PROBE_LINES.join('\n')}\n`, 'utf8');
      const seen = ENGINE_PROBE_LINES.map((_line, i) => {
        const out = execFileSync(
          'git',
          ['grep', '--no-index', '-c', '-F', ENGINE_PROBE_LINES[i], '--', 'probe.txt'],
          { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return Number(out.trim().split(':')[1]);
      });
      expect(seen).toEqual([1, 1, 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every census anchor carrying `\\b` or `\\s` runs through PCRE — `-E` is not an option while they do', () => {
    // The coupling, pinned: this is the edit objectui#8361 asks for, and the
    // guard against it being quietly reverted one anchor at a time.
    const posixIncompatible = REGEX_ANCHORS.filter((a) => a.includes('\\b') || a.includes('\\s'));
    expect(posixIncompatible.length, 'no anchor needs PCRE any more — re-derive this pin')
      .toBe(REGEX_ANCHORS.length);
    expect(
      GREP_ENGINE_FLAG,
      `${posixIncompatible.length} anchors use \`\\b\`/\`\\s\`, which POSIX ERE does not define; `
        + 'under `-E` they are silently dead on a BSD-regex host (macOS)',
    ).toBe('-P');
  });
});

describe('census: NOTHING reads the retired `AppComponentSchema.actions[]`, with the scope in the assertion (objectui#7721 instrument, objectui#7469 retirement)', () => {
  it('the scan is ALIVE and SELECTIVE — a large population that the anchors narrow, not an empty grep', () => {
    const { namesType, readsActions, anchorA, anchorB } = scan();
    // A filter over an empty scan passes vacuously, and "no reader" is exactly
    // what a dead pattern renders as. Both directions get a counter-probe.
    expect(
      readsActions.length,
      'nothing in the tree reads `.actions` — the anchor is dead. Before hunting for a tree '
        + 'change, read the engine self-test above: a `\\b` anchor is dead on ANY engine that '
        + 'does not have `\\b` (objectui#8361)',
    ).toBeGreaterThan(20);
    // `ANCHOR_NAMES_TYPE` is `-F`, so this half cannot be moved by the engine —
    // it stays the control that separates "the tree changed" from "the regex
    // engine changed": a literal search has no `\b` to lose.
    expect(namesType.size, 'nothing names `AppComponentSchema` — the anchor is dead')
      .toBeGreaterThan(5);
    expect(anchorA.length, 'anchor A matched nothing').toBeGreaterThan(0);
    expect(anchorB.length, 'anchor B matched nothing').toBeGreaterThan(0);
    // …and they must actually narrow, or the empty reader set is an artefact.
    expect(anchorA.length).toBeLessThan(readsActions.length);
    expect(anchorB.length).toBeLessThan(readsActions.length);
  });

  it('the three packages the OLD scope named were in the population and were rejected by the anchors — the negative is a reading, not an unvisited absence', () => {
    // The control for a scan has to come from the POPULATION side: "no reader
    // in `@object-ui/layout`" says nothing unless layout reached the grep at
    // all. That is precisely how the sentence this card fixes stayed true.
    const { readsActions, readers } = scan();
    const OLD_SCOPE = ['packages/layout/', 'packages/app-shell/', 'apps/console/'] as const;
    for (const prefix of OLD_SCOPE) {
      expect(
        readsActions.some((f) => f.startsWith(prefix)),
        `${prefix} contributed no file to the population — it was never scanned`,
      ).toBe(true);
      expect(
        readers.filter((f) => f.startsWith(prefix)),
        `${prefix} now reads the array — it is RETIRED and refused by name (objectui#7469)`,
      ).toEqual([]);
    }
  });

  it('no file outside `packages/types` reads the array — the retired key has no reader', () => {
    const { readers } = scan();
    expect(
      readers,
      'a file reads `actions` off an app again — the key is RETIRED on both faces and '
        + 'refused by name (objectui#7469, maintainer ruling C); app-level actions are '
        + '`navigation` items of `type: \'action\'`. Do not widen ACTIONS_READER_FILES',
    ).toEqual([...ACTIONS_READER_FILES]);
    // Named for the diagnostic above, so a failure also says WHICH package grew one.
    expect([...new Set(readers.map(packageNameOf))]).toEqual([]);
  });

  it('`packages/types` matches only as PROSE — the retirement pin and this census, and no third file', () => {
    const { anchorA, anchorB } = scan();
    const inTypes = [...new Set([...anchorA, ...anchorB])]
      .filter((f) => f.startsWith(DECLARING_PACKAGE_PREFIX))
      .sort();
    expect(inTypes).toEqual([...DECLARING_PACKAGE_PROSE]);
  });

  it('the FORMER reader is still in the population and is no longer a reader — the empty set is a reading', () => {
    // The control for an empty reader set has to be the file that USED to be
    // in it: it still names `AppComponentSchema` (so the scan reached it), and
    // the anchors now reject it. Its two filters are gone from the source.
    const { namesType, readers } = scan();
    expect(namesType.has(FORMER_READER_FILE), `${FORMER_READER_FILE} left the population — re-derive this control`)
      .toBe(true);
    expect(readers).not.toContain(FORMER_READER_FILE);
    const src = readFileSync(join(REPO_ROOT, FORMER_READER_FILE), 'utf8');
    expect(src).not.toMatch(/\bapp\??\.actions\b/);
  });

  it('`AppAction` is imported nowhere outside `packages/types` — it is retired, and the runner never imported it', () => {
    const importers = gitGrepFiles(['-l', GREP_ENGINE_FLAG, ANCHOR_IMPORTS_APP_ACTION])
      .filter((f) => !f.startsWith(DECLARING_PACKAGE_PREFIX));
    expect(importers).toEqual([]);
    // An empty result needs a known-hit control, or it is indistinguishable
    // from a dead pattern: the same anchor on the sibling type must find files.
    const control = gitGrepFiles(['-l', GREP_ENGINE_FLAG, ANCHOR_IMPORTS_NAMES_TYPE])
      .filter((f) => !f.startsWith(DECLARING_PACKAGE_PREFIX));
    expect(
      control.length,
      'the import anchor found nothing at all — if this host\'s git has no PCRE the engine '
        + 'self-test above names it; otherwise the tree moved',
    ).toBeGreaterThan(0);
    // The retired symbol survives outside `packages/types` only as PROSE, in
    // the runner's own retirement pin (objectui#7469), which names what it
    // retired. A second file mentioning it is new code reaching for a type
    // that no longer exists.
    const mentions = gitGrepFiles(['-l', GREP_ENGINE_FLAG, ANCHOR_MENTIONS_APP_ACTION])
      .filter((f) => !f.startsWith(DECLARING_PACKAGE_PREFIX));
    expect(mentions).toEqual(['packages/runner/src/__tests__/LayoutRenderer.chrome-7469.test.tsx']);
  });
});

/* ── Behaviour: the string dialect is refused BY NAME, not parsed green ──── */

describe('the handler-expression string dialect is refused by name (objectui#6182 → the #6124 shape)', () => {
  it.each(ALL_SITES)('%s %s.%s refuses an authored STRING at its own path with code `custom` and the guidance', (_file, _schema, key, mirror) => {
    for (const authored of AUTHORED_STRINGS) {
      const result = pickKey(mirror, key).safeParse({ [key]: authored });
      expect(result.success, `\`${key}: ${JSON.stringify(authored)}\` parsed green`).toBe(false);
      if (result.success) return;
      // ON THE KEY: an issue addressed to `key`, not merely a failed parse.
      const issue = result.error.issues.find((i) => String(i.path[0]) === key);
      expect(issue, `no issue addressed to \`${key}\``).toBeDefined();
      expect(issue!.code).toBe('custom');
      expect(issue!.path).toEqual([key]);
      expect(issue!.message).toContain(`\`${key}\``);
      // The #6498 remedy, and the one-string invariant: the runtime message
      // IS the `.describe()` metadata.
      expect(issue!.message).toContain('"type"');
      expect(issue!.message).toContain('action:button');
      expect(issue!.message).toBe(describeOf(mirror, key));
    }
  });

  it.each(ALL_SITES)('%s %s.%s refuses an authored action OBJECT too — no declarative-object arm', (_file, _schema, key, mirror) => {
    const result = pickKey(mirror, key).safeParse({ [key]: AUTHORED_ACTION_OBJECT });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, String(i.path[0])])).toEqual([['custom', key]]);
  });

  it.each(ALL_SITES)('%s %s.%s refuses a LIVE FUNCTION — the JSON mirror is not the programmatic channel', (_file, _schema, key, mirror) => {
    // The accept-set change the changeset declares, in the `z.any()` /
    // `z.function()` direction: a function that parsed green here was the
    // instrument's positive control, never an authoring form.
    const result = pickKey(mirror, key).safeParse({ [key]: LIVE_FUNCTION });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, String(i.path[0])])).toEqual([['custom', key]]);
  });

  it.each(ALL_SITES)('%s %s.%s — the same isolated shape parses GREEN without the key (the arm is optional; the refusal is about the key)', (_file, _schema, key, mirror) => {
    expect(pickKey(mirror, key).safeParse({}).success).toBe(true);
  });

  it('the guidance wording distinguishes a runtime slot from a retired key', () => {
    for (const [, , key, mirror] of RUNTIME_SLOT) {
      expect(describeOf(mirror, key), key).toContain('RUNTIME SLOT');
      expect(describeOf(mirror, key), key).not.toContain('RETIRED');
    }
    for (const [, , key, mirror] of RETIRED) {
      expect(describeOf(mirror, key), key).toContain('RETIRED (objectui#6124');
      expect(describeOf(mirror, key), key).not.toContain('RUNTIME SLOT');
    }
  });
});

/* ── Counter-probes: why an arm, and not a deletion, on BOTH base shapes ─── */

describe('counter-probe: deleting the key instead is a SILENT accept on either base shape (the ruling\'s ⛔ 不裸删)', () => {
  const detailView = { type: 'detail-view', title: 'Account', onBack: 'goBack' };

  it('with the arm: a whole `detail-view` document is refused at path onBack', () => {
    const result = DetailViewZod.safeParse(detailView);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([['onBack']]);
  });

  it('the deletion, simulated on a `.passthrough()` mirror: parses GREEN and KEEPS the string, which then reaches `DetailView.onBack` and throws at click', () => {
    const result = DetailViewZod.omit({ onBack: true }).safeParse(detailView);
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).onBack).toBe('goBack');
  });

  // The plain-`z.object` half of this pair ran on `AppActionSchema.onClick`, the
  // only ledgered site on that base shape, and left with the schema
  // (objectui#7469, maintainer ruling C). The other silence it showed — an
  // undeclared key STRIPPED rather than kept — is still measured on a plain
  // `z.object` mirror, `MenuItemSchema`, in
  // `./app-menu-item-shortcut-refusal-7719.test.ts` (its STRIP block).
});

/* ── The TypeScript face, judged by `tsc -p tsconfig.test.json` ──────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** `?: never` reads as exactly `undefined` off the interface (`Equal`, not
 *  `extends`, because `BaseSchema`'s index signature made a DELETED member read
 *  `any` until objectui#8347, which a one-way check would accept). */
type RetiredIsNever<T> = Equal<T, undefined>;

/** A runtime slot keeps a callable member. Over `NonNullable` so `undefined`
 *  cannot satisfy it. */
type KeepsFunction<T> = [Extract<NonNullable<T>, (...args: never[]) => unknown>] extends [never]
  ? false
  : true;

/** The string dialect is gone from the TypeScript face too (objectui#6182: "not
 *  a supported authoring form" on BOTH faces): no `string` survives the member. */
type StringIsGone<T> = [Extract<NonNullable<T>, string>] extends [never] ? true : false;

export type assertionRetiredKeysAreTombstoned = [
  Expect<RetiredIsNever<ReportBuilderSchema['onSave']>>,
  Expect<RetiredIsNever<ReportBuilderSchema['onCancel']>>,
  Expect<RetiredIsNever<CRUDDialogSchema['onClose']>>,
];

export type assertionRuntimeSlotsKeepTheirFunctionType = [
  Expect<KeepsFunction<DetailViewSchema['onBack']>>,
  Expect<KeepsFunction<DetailSchema['onBack']>>,
  // objectui#7804, listed here for uniformity but ⛔ NOT the assertion that
  // holds them: these two were UNDECLARED, not `string` / `any`, so their base
  // state was `BaseSchema`'s index signature — and `KeepsFunction<any>` is
  // `true` (`[any] extends [never]` is false). On this pair the helper CANNOT
  // FAIL, which is exactly the reason `RetiredIsNever` above is spelled with
  // `Equal`. `assertionDetailSlotsAreDECLARED` below is the one with a control
  // that fires.
  Expect<KeepsFunction<DetailSchema['onNavigate']>>,
  Expect<KeepsFunction<DetailSchema['onAddComment']>>,
  Expect<KeepsFunction<ActionSchema['onClick']>>,
  Expect<KeepsFunction<CalendarViewSchema['onEventClick']>>,
];

/** The former `string` twins — `reports.ts` ×2, `views.ts` (the fourth, `app.ts`'s
 *  `AppAction.onClick`, left with its type: objectui#7469). */
export type assertionStringTwinsStopDeclaringString = [
  Expect<StringIsGone<ReportBuilderSchema['onSave']>>,
  Expect<StringIsGone<ReportBuilderSchema['onCancel']>>,
  Expect<StringIsGone<DetailViewSchema['onBack']>>,
];

/**
 * The member is DECLARED on the interface, not read through the
 * `[key: string]: any` index signature `BaseSchema` carried until objectui#8347.
 *
 * ⚠️ This exists because objectui#7804's two keys enter this ledger from a base
 * state the other four never had: ABSENT. `Extract`-based helpers read an
 * absent member as `any` and answer `true` for it, so a one-way check would
 * have passed on the unmodified tree and asserted nothing. `Equal` separates
 * `any` from a real declaration, which is the same reason `RetiredIsNever` is
 * spelled with it.
 */
type DeclaresExactly<T, Shape> = Equal<T, Shape | undefined>;

/** objectui#7804 — the two `'detail'` slots declare the signature their call
 *  site builds, and the control proves the check can fail on an ABSENT member. */
export type assertionDetailSlotsAreDECLARED = [
  Expect<DeclaresExactly<DetailSchema['onNavigate'], (url: string, options?: { replace?: boolean; newTab?: boolean }) => void>>,
  Expect<DeclaresExactly<DetailSchema['onAddComment'], (text: string) => void | Promise<void>>>,
];

// The four helpers must be able to FAIL — synthetic controls, both directions.
export type assertionDeclaresExactlyCanFail = [
  // an ABSENT member, as `BaseSchema`'s index signature typed it (until objectui#8347)
  Expect<Equal<DeclaresExactly<any, () => void>, false>>,
  // a DECLARED member with the wrong signature
  Expect<Equal<DeclaresExactly<((n: number) => void) | undefined, () => void>, false>>,
];
export type assertionRetiredIsNeverCanFail = Expect<Equal<RetiredIsNever<(() => void) | undefined>, false>>;
export type assertionKeepsFunctionCanFail = Expect<Equal<KeepsFunction<string | undefined>, false>>;
export type assertionStringIsGoneCanFail = Expect<Equal<StringIsGone<string | undefined>, false>>;
