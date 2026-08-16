// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * i18n-bundle-surface — the ONE enumeration of what moves a translation bundle.
 *
 * Two readers need the same answer and used to compute it apart:
 *
 *   - scripts/check-i18n-bundles.mjs   the GATE. Walks packages/ for extract
 *     configs, reads each config's documented flags, re-extracts, fails on drift.
 *   - scripts/pm/dispatch-gates.mjs    the DERIVATION. Has to predict, from a
 *     card's file surface alone, whether that gate can move — before the code
 *     exists.
 *
 * The derivation used to mirror the gate's walk by hand ("same skip set, same
 * filename test", said its comment). A mirror is a second contract: it agrees
 * until the day one side changes, and the day it disagrees nothing says so. So
 * the walk lives here once and both import it — the shape scripts/cli-build-
 * prerequisite.mjs already has for the two prerequisite classifiers this gate
 * and check-i18n-coverage.mjs share.
 *
 * ## Why the metadata-forms half is here and not inferred
 *
 * A bundle has two producers, and only one of them lives in the package that
 * owns the bundle:
 *
 *   - `objects` — the config's own package enumerates them, so the owning
 *     package IS the trigger surface;
 *   - `metadataForms` — registry-driven and identical for every stack, so
 *     exactly one package commits that baseline (platform-objects today) and
 *     every other config passes --no-metadata-forms. Its source is not in the
 *     owning package at all: it is the form modules in packages/spec that
 *     METADATA_FORM_REGISTRY collects.
 *
 * That second edge is what cost PR 9113 a CI round: two form entries were added
 * in packages/spec, four platform-objects bundles moved, check:i18n went red,
 * and no derivation from those paths could have named the family — the gate's
 * own walk never reaches packages/spec, and packages/spec owns no extract
 * config. The KIND is written down (a form module), the POPULATION is walked at
 * runtime, and whether the surface is extracted AT ALL is read from the configs'
 * own documented flags rather than assumed.
 *
 * ## The one convention this module writes down
 *
 * A metadata form module is a file whose name ends `.form.ts`. That is the
 * producer's own convention, stated by the registry it feeds — packages/spec/
 * src/system/metadata-form-registry.ts: "the FormView produced by
 * defineForm({ schemaId }) in the corresponding *.form.ts". Measured on this
 * tree when this module landed: 17 files in the repo carry that suffix, all of
 * them under packages/spec/src, and the registry has exactly 17 entries with a
 * form — the convention and the population coincide, with nothing left over on
 * either side.
 *
 * What it deliberately does NOT cover, measured and stated so the next reader
 * does not mistake silence for coverage: the type-level half of the same
 * surface. `walkMetadataForms` in packages/cli/src/utils/i18n-extract.ts emits
 * `metadataForms.TYPE.label`/`.description` for every entry of
 * DEFAULT_METADATA_TYPE_REGISTRY (packages/spec/src/kernel/metadata-plugin.zod.ts),
 * and the registry module itself decides which forms are walked. Editing either
 * moves the same four bundles and matches no convention here, because neither
 * carries a filename that distinguishes it. Closing that edge needs an anchor
 * this module does not have, and the candidates trade off against each other
 * rather than being one obvious shape, so it is filed rather than guessed at:
 * issue 9144.
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Directory entries no walk here descends into — the gate's original skip set. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

/** The filename every extract config carries. */
export const EXTRACT_CONFIG_FILENAME = 'i18n-extract.config.ts';

/**
 * The flag a package passes to keep the shared Studio metadata-form baseline
 * out of its own bundles.
 *
 * Mirrors the ONE condition the emitter uses (`emitsMetadataForms` in
 * packages/cli/src/commands/i18n/extract.ts): the companion
 * metadata-forms.generated.ts file is written when the `metadata-forms` boolean
 * flag is on and the locale has keys. `--objects-only` is orthogonal — that one
 * picks a sub-tree of the objects module and the emitter says so in its own
 * comment — so it is deliberately not consulted here.
 */
export const METADATA_FORMS_OPT_OUT_FLAG = '--no-metadata-forms';

/** The filename suffix of a metadata form module. See the module note. */
export const METADATA_FORM_MODULE_SUFFIX = '.form.ts';

/**
 * Does this path name an extract config? The FILENAME plus a `scripts/`
 * segment — the gate's original test, kept whole rather than approximated.
 */
export function isExtractConfigPath(path) {
  return basename(path) === EXTRACT_CONFIG_FILENAME && path.includes('/scripts/');
}

/**
 * Does this path name a metadata form module?
 *
 * The suffix must be preceded by a name: a file called exactly `.form.ts` is a
 * dotted entry every walk here already skips, and accepting it would let the
 * bare suffix match as a path.
 */
export function isMetadataFormModulePath(path) {
  const name = basename(path);
  return name.length > METADATA_FORM_MODULE_SUFFIX.length && name.endsWith(METADATA_FORM_MODULE_SUFFIX);
}

/**
 * Every extract config under `absDir`, as `{ rel, abs }`.
 *
 * Both halves are returned because both readers need a different one: the gate
 * runs from the repo root and reports repo-relative paths, while a caller
 * walking from an absolute root still has to OPEN each config to read its
 * documented flags. Deriving one from the other at the call site is how the two
 * spellings drift.
 */
export function findExtractConfigs(absDir, rel, out = []) {
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    const abs = join(absDir, e.name);
    if (e.isDirectory()) findExtractConfigs(abs, child, out);
    else if (isExtractConfigPath(child)) out.push({ rel: child, abs });
  }
  return out;
}

/**
 * Every metadata form module under `absDir`, repo-relative, in walk order.
 *
 * Same skip set as the config walk: a form module inside node_modules or dist
 * is a build artifact of one, not a source the extractor reads.
 */
export function findMetadataFormModules(absDir, rel, out = []) {
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) findMetadataFormModules(join(absDir, e.name), child, out);
    else if (isMetadataFormModulePath(child)) out.push(child);
  }
  return out;
}

/**
 * Read the regenerate command a config documents about itself. Every flag the
 * gate passes comes from there, so a package that changes its locales or output
 * directory updates one place and both readers follow.
 */
export function flagsFromDocstring(configPath) {
  const src = readFileSync(configPath, 'utf8');
  const head = src.slice(0, src.indexOf('*/') + 2);
  const flags = head.match(/--(?:locales|fill|out)=[^\s\\*]+|--(?:objects-only|no-metadata-forms|no-merge)\b/g) ?? [];
  return [...new Set(flags)];
}

/** Same question, over already-parsed flags — the pure half, for offline tests. */
export function flagsExtractMetadataForms(flags) {
  return !flags.includes(METADATA_FORMS_OPT_OUT_FLAG);
}

/**
 * Does ANY discovered config still commit the shared metadata-form baseline?
 *
 * This is the applicability question the form-module convention hangs on, and
 * it is read from the configs rather than assumed: the day the last config
 * passes --no-metadata-forms, no form module can move a committed bundle any
 * more, and a derivation that kept naming check:i18n for one would be sending
 * every spec card to a gate that cannot go red.
 */
export function anyConfigExtractsMetadataForms(configs) {
  return configs.some((c) => flagsExtractMetadataForms(flagsFromDocstring(c.abs)));
}
