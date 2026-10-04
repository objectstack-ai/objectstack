// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { objectNotFoundError } from '@objectstack/core';

/**
 * The `--object` scope of the `os migrate` data-migration family (#21644):
 * `value-shapes`, `files-to-references`, `summary-nulls` and `duplicates`.
 *
 * ## An unknown name is refused, never narrowed to nothing
 *
 * Each command hands `--object` to its scan as the candidate list, and every
 * scan keeps only the candidates it covers. A name the deployment does not
 * declare used to be filtered out without a word: a misspelled `--object`
 * scanned nothing, reported it clean and exited 0, and `value-shapes --apply`
 * went on to record the deployment flag as verified over that empty scan.
 *
 * So a name the booted registry does not declare is refused before the scan,
 * with the platform's own envelope: `objectNotFoundError`, `OBJECT_NOT_FOUND`,
 * the answer `os migrate unmapped-columns` gives the same mistake. The message
 * names every unknown name and the declared objects.
 *
 * "Declared" is the registry the command's own boot resolved, which is the set
 * each scan draws its default candidates from (`engine.getConfigs()`, or
 * `stack.allObjects()` for `duplicates`). The refusal and the scan therefore
 * judge one population. A declared object the command has nothing to check on
 * (no covered field) is NOT refused: it is a real object, and an empty answer
 * about it is a true one.
 *
 * ## A narrowed run records no deployment-level flag
 *
 * `value-shapes` and `files-to-references` record a flag that attests the
 * stored data of the whole deployment, and that flag turns strict enforcement
 * on. A run narrowed by `--object` read only the named objects, so it can
 * attest nothing about the rest: it applies its fixes and records no flag.
 *
 * Any `--object` narrows, even a list that happens to name every declared
 * object. The flag is earned by the one spelling that means "every object",
 * a run without `--object`, and never by comparing a list against the
 * registry of the moment. A second definition of "the whole deployment" would
 * have to track every way the declared set can change between two runs.
 */

/**
 * Was this run narrowed by `--object`? Any list narrows, an empty one too: a
 * scan handed `[]` walks nothing, which is the last run a flag may come from.
 */
export function isNarrowedRun(objects: readonly string[] | undefined): objects is readonly string[] {
  return objects !== undefined;
}

/**
 * The sentence both faces print on a narrowed run of a flag-recording
 * command, so the operator learns why no flag was recorded and the one
 * command that records it.
 */
export function narrowedFlagNote(command: string, objects: readonly string[], apply: boolean): string {
  const list = objects.length > 0 ? objects.join(', ') : 'no object';
  return (
    `Narrowed by --object to ${list}` +
    (apply ? ', so no deployment flag was recorded.' : '.') +
    ' The flag attests the stored data of every object, so only a run without --object records it: ' +
    `"os migrate ${command} --apply".`
  );
}

/**
 * Refuse every `--object` name the booted registry does not declare, before
 * anything is scanned or written.
 *
 * Throws the `OBJECT_NOT_FOUND` envelope (`code`, `status: 404`, `object`
 * naming the first unknown name). Its message names every unknown name and the
 * declared objects, sorted.
 */
export function refuseUndeclaredObjects(
  requested: readonly string[] | undefined,
  declared: Iterable<string>,
): void {
  if (!requested || requested.length === 0) return;
  const known = new Set(declared);
  const unknown = [...new Set(requested.filter((name) => !known.has(name)))];
  if (unknown.length === 0) return;

  const error = objectNotFoundError(unknown[0]);
  const names = unknown.map((name) => `'${name}'`).join(', ');
  const declaredList = [...known].sort();
  error.message =
    `${unknown.length === 1 ? 'Object' : 'Objects'} ${names} not found: --object takes an object this ` +
    'deployment declares, and nothing was scanned. ' +
    (declaredList.length > 0
      ? `Declared objects: ${declaredList.join(', ')}.`
      : 'This deployment declares no object.');
  throw error;
}
