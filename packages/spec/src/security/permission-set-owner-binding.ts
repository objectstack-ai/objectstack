// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0086 D3] The owner-binding judge for a permission set's body
 * `packageId`: ONE comparison and ONE set of words, called by every door that
 * files a permission set under a package.
 *
 * ## The rule
 *
 * D3 declares the key as "the owning package for a package-shipped set
 * (absent ⇒ env-authored)", and every reader of a set's owner reads the
 * BINDING: the package the set is shipped from or saved into (the registry's
 * `_packageId`, a stored row's `package_id`). A body that declared another
 * owner used to be accepted and its declaration silently overridden, so an
 * author (an AI build above all) was never told that the owner it wrote is not
 * the owner it got. The seat's ruling is to refuse it, with a prescription.
 *
 * | body `packageId` | the binding | verdict |
 * |:--|:--|:--|
 * | absent | anything | accepted: an absent key declares nothing |
 * | `'P'` | `'P'` | accepted |
 * | `'Q'` | `'P'` | refused |
 * | any string, `''` included | none | refused: a present key declares a package-shipped set, and nothing ships it as one |
 *
 * A value that is not a string is the schema's to refuse (`z.string()`), with
 * its own located issue, so it is not judged here. An empty-string binding is
 * no package, the normalisation both hydration seams apply.
 *
 * ## The doors, and why the judge lives in this package
 *
 * | door | caller | the binding it passes |
 * |:--|:--|:--|
 * | `build` | the stack schema's refinement (`ObjectStackDefinitionSchema`, `stack.zod.ts`): `defineStack`, `os validate`, `os build`, the artifact door's parse | the stack's `manifest.id` (none without a manifest); each `packages[]` body's own `id` |
 * | `register` | `ObjectQL.registerApp`, for a manifest no schema parse judged (`@objectstack/objectql`) | the package id it registers under |
 * | `save` / `restore` / `publish` | the metadata write doors (`@objectstack/metadata-protocol`) | the resolved binding of the row the write lands in |
 *
 * `@objectstack/spec` is the one layer every one of those callers already
 * depends on, the stack schema included, so the judge lives here and nowhere
 * else. ⛔ Do not write a second comparison at a door: two doors spelling one
 * rule differently is how one comes to accept what the other refuses.
 *
 * ## The words
 *
 * Pure: it builds no error and throws nothing. Each door wraps
 * {@link PermissionSetOwnerBindingRefusal} in its own envelope: the build door
 * as a schema issue at the set's `packageId`, the others as ADR-0112's
 * `VALIDATION_ERROR` / 400 with `issues[]` at `packageId`. The message
 * prescribes first, because a 4xx message crosses the REST boundary bounded at
 * 500 characters with its TAIL truncated, names both values, and offers the two
 * remedies the ruling names: drop the key, or put the set where it declares.
 * A restore writes a stored version its caller cannot edit in place, so its
 * remedy is the save that fixes it. The words of the three metadata write doors
 * are byte for byte the words those doors printed before the judge moved here.
 * Runtime words carry no tracker number.
 */

/** The door judging the set: where its binding comes from, and what fixes it there. */
export type PermissionSetOwnerBindingDoor = 'save' | 'restore' | 'publish' | 'build' | 'register';

/** A disagreement, in the words every door shows it with. */
export interface PermissionSetOwnerBindingRefusal {
  /** The body's `packageId`, as authored. */
  readonly declared: string;
  /** The binding judged against, normalised: `null` is no package. */
  readonly bound: string | null;
  /** The refusal sentence: the prescription first, then both values, then the rule. */
  readonly message: string;
  /** The located sentence a door's `issues[]` entry at `packageId` carries. */
  readonly issueMessage: string;
}

/** The binding as the words show it: `null` is no package. */
const boundOf = (binding: string | null | undefined): string | null =>
  typeof binding === 'string' && binding !== '' ? binding : null;

/**
 * Judge one permission set's body `packageId` against the binding of the door
 * that files it.
 *
 * @param item    The permission set's body, as authored (anything: a non-object
 *   or a non-string `packageId` is not judged here).
 * @param name    The set's name, as the words show it.
 * @param binding The package the door files the set under: `null`, `undefined`
 *   or `''` for none.
 * @param door    Which door is asking (see the module header).
 * @returns The refusal when the key disagrees with the binding, else `undefined`.
 */
export function judgePermissionSetOwnerBinding(
  item: unknown,
  name: string,
  binding: string | null | undefined,
  door: PermissionSetOwnerBindingDoor,
): PermissionSetOwnerBindingRefusal | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const declared = (item as { packageId?: unknown }).packageId;
  if (typeof declared !== 'string') return undefined;
  const bound = boundOf(binding);
  if (declared === bound) return undefined;
  const shown = bound === null ? 'none' : `'${bound}'`;
  if (door === 'build' || door === 'register') {
    const shipDeclared = declared === '' ? '' : `, or ship the set from package '${declared}'`;
    const owner = bound === null
      ? 'a set no package ships is environment-authored, which an absent `packageId` states'
      : 'the package that ships a set is its owner';
    const tail = `and ${owner} (ADR-0086 D3): a \`packageId\` that disagrees is refused, never silently overridden.`;
    const message = door === 'build'
      ? `Drop \`packageId\` from permission set '${name}'${shipDeclared}`
        + `${declared === '' ? '' : ` (the stack whose \`manifest.id\` is '${declared}')`}. `
        + `Its body declares \`packageId\` '${declared}', but this stack ships it `
        + `${bound === null ? 'from no package (the stack declares no `manifest`)' : `from package '${bound}'`}, ${tail}`
      : `Drop \`packageId\` from permission set '${name}'${shipDeclared}, then build and install the package again. `
        + `Its body declares \`packageId\` '${declared}', but it is registered `
        + `${bound === null ? 'into no package' : `under package '${bound}'`}, ${tail}`;
    return {
      declared,
      bound,
      message,
      issueMessage: `Disagrees with the package that ships the set (${shown}): drop it${shipDeclared}.`,
    };
  }
  const into = (pkg: string | null) => (pkg === null ? 'into no package' : `into package '${pkg}'`);
  const intoDeclared = declared === ''
    ? ''
    : `, or ${door === 'save' ? 'save the set' : 'save it'} into package '${declared}' `
      + `(?package=${declared} on the REST door, packageId in process)`;
  const owner = bound === null
    ? 'a set written into no package is authored in this environment, which an absent `packageId` states'
    : 'the package a set is written into is its owner';
  const tail = `and ${owner} (ADR-0086 D3): a \`packageId\` that disagrees is refused, never silently overridden.`;
  const message = door === 'save'
    ? `Drop \`packageId\` from permission set '${name}'${intoDeclared}, then send it again. Nothing was written. `
      + `Its body declares \`packageId\` '${declared}', but this save writes it ${into(bound)}, ${tail}`
    : door === 'restore'
      ? `Save permission set '${name}' again with \`packageId\` ${bound === null ? 'dropped' : `dropped or set to '${bound}'`}, `
        + 'instead of restoring this version. Nothing was restored. '
        + `The version's body declares \`packageId\` '${declared}', but it is restored ${into(bound)}, ${tail}`
      : `Save the draft of permission set '${name}' again with \`packageId\` dropped${intoDeclared}, then publish it. `
        + `Nothing was published. Its body declares \`packageId\` '${declared}', but it is published ${into(bound)}, ${tail}`;
  return {
    declared,
    bound,
    message,
    issueMessage: `Disagrees with the package the set is written into (${shown}): `
      + (door === 'restore'
        ? `drop it${bound === null ? '' : `, or set it to '${bound}'`}.`
        : `drop it${declared === '' ? '' : `, or write the set into package '${declared}'`}.`),
  };
}
