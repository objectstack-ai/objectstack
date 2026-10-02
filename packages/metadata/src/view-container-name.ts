// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/view-container-name` — the divergent view-container
 * `name` refusal: ONE judge, called by every door that files a container.
 *
 * ## What it judges
 *
 * A container's own `name`, when set, must equal the key the door files the
 * container under. A disagreement is refused: resolving it silently in either
 * direction files the item under a key the author never wrote (#7378 row 1).
 * The maintainer's ruling of 2026-09-03 (direction 2) made the source
 * registrars refuse it; the runtime save door is the third door, ruled on
 * #21412 (seat answer, Q1 A).
 *
 * The doors differ in WHERE their key comes from, and only there:
 *
 *  - **The source registrars** — the ObjectQL boot loop, `os validate` /
 *    `os compile` (the same judge, through `@objectstack/objectql`) and the
 *    artifact/HMR loader (`plugin.ts`) — file a container under the object it
 *    binds to, so their key is DERIVED: {@link viewContainerNameRefusal}.
 *  - **The runtime save door** (`saveMetaItem`, which REST `PUT
 *    /meta/view/:name` and the dispatcher both call) files the row under the
 *    name it is SAVED under, and that name is not always the binding: the
 *    door keeps a container saved under a name other than its object (#13407)
 *    and expands one on another package's object under its own name (#21334).
 *    So its key is the save name: {@link savedViewContainerNameRefusal}.
 *
 * Judging the save door against the derived key instead was measured and
 * refused (#21412 probes P2–P4): it refuses the body that same door stores
 * for the #13407 shape when it is sent back, and it passes two bodies whose
 * `name` disagrees with the row, which then register under the body's name.
 *
 * ## Why the derived entry derives the key itself
 *
 * For a container, the key the source registrars file under IS
 * {@link deriveViewContainerObject} — the first branch of the boot loop's
 * `resolveMetadataItemName` returns exactly that, gated on the same
 * {@link isAggregatedViewContainer}, and the artifact door derives the same
 * value before it registers. Taking the key as a parameter there would make
 * every one of those callers re-derive it, a second spelling of "which
 * derivation does a source registrar use" — so that entry keeps deriving. The
 * save door's key is not a derivation at all; it is the request's own name,
 * which is why that entry takes it.
 *
 * ## The gate, carried whole
 *
 *   * {@link isAggregatedViewContainer} — the CONTAINER branch only. A
 *     standalone ViewItem's `name` is its identity, not a binding (the
 *     every-type half at the save door is #21470);
 *   * `name` a non-empty string AND different from the key. A container with
 *     no `name` is untouched (the save door stamps one);
 *   * a falsy key refuses nothing: the boot loop warns and skips an entry
 *     whose derived key is falsy, and `deriveViewContainerObject`'s `??` chain
 *     can keep `''` (`list: { data: { object: '' } }`), so a door that calls
 *     this alone cannot refuse what boot skips.
 *
 * ## The words
 *
 * One template; each door supplies only where its key came from
 * ({@link KeyOrigin}). The source registrars' rendering is byte for byte the
 * words the boot loop and `os validate` have always printed. The runtime
 * string carries NO tracker id (`check:doc-authoring`). The envelope is
 * ADR-0112's `VALIDATION_ERROR` / 400 at every door.
 *
 * ## Why a subpath of its own
 *
 * `@objectstack/metadata` is the one layer all three doors already depend on
 * (`@objectstack/objectql` and `@objectstack/metadata-protocol` list it, and
 * the artifact door lives in it); `@objectstack/core` cannot host it, because
 * `@objectstack/metadata` lists core and the judge needs the derivation that
 * lives here. It is NOT on the `./view-container` leaf: that entry imports
 * nothing at all (its header measures why), and this one needs
 * `isAggregatedViewContainer` from `@objectstack/spec`. Nor on the ROOT entry,
 * which loads the manager and the filesystem machinery that objectql's
 * ADR-0076 lean entry must not reach.
 */

import { isAggregatedViewContainer } from '@objectstack/spec';
import { deriveViewContainerObject } from './view-container.js';

/** The refusal, in the ADR-0112 envelope every door throws it in. */
export interface ViewContainerNameRefusal extends Error {
  code: 'VALIDATION_ERROR';
  status: 400;
  httpStatus: 400;
}

/**
 * Where a door's key came from — the only words that differ between doors.
 * `subject` names the container and its source, `key` says what the key is,
 * `keyDetail` follows the key, and `alsoRefused` follows the shared reason.
 */
interface KeyOrigin {
  subject: string;
  key: string;
  keyDetail: string;
  alsoRefused: string;
}

function refusal(name: string, key: string, origin: KeyOrigin): ViewContainerNameRefusal {
  const err = new Error(
    `Invalid ${origin.subject}: the container's own `
    + `\`name\` is '${name}', which disagrees with ${origin.key}, `
    + `'${key}'${origin.keyDetail}. A disagreement is almost always an authoring bug, and resolving `
    + 'it silently in either direction can file the item under a key the caller never wrote '
    + `(refuse loudly, locate the mismatch)${origin.alsoRefused}. Register under one name: drop \`name\`, or set it to `
    + `'${key}'.`,
  ) as ViewContainerNameRefusal;
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  return err;
}

/** The judgement every door shares: a set own `name` that is not the key. */
function judge(container: unknown, key: string | undefined, origin: () => KeyOrigin): ViewContainerNameRefusal | undefined {
  if (!isAggregatedViewContainer(container)) return undefined;
  const name = (container as { name?: unknown }).name;
  if (typeof name !== 'string' || !name) return undefined;
  if (!key) return undefined;
  if (name === key) return undefined;
  return refusal(name, key, origin());
}

/**
 * Judge one `views:` entry at a SOURCE registrar: the refusal when it is an
 * aggregated container whose own `name` disagrees with the object key it binds
 * to, else `undefined`.
 *
 * Pure: it throws nothing and registers nothing. The boot registrar and the
 * artifact door throw what it returns; `os validate` reports it.
 *
 * @param container   One entry of a `views:` collection.
 * @param sourceLabel The words naming the source (`manifest`, `nested plugin`,
 *   `artifact`).
 * @param ownerId     The owning package id the registrar stamps.
 */
export function viewContainerNameRefusal(
  container: unknown,
  sourceLabel: string,
  ownerId: string | undefined,
): ViewContainerNameRefusal | undefined {
  return judge(container, deriveViewContainerObject(container), () => ({
    subject: `\`views:\` container from ${sourceLabel} '${ownerId}'`,
    key: 'the object key it binds to',
    keyDetail: ' (derived from its own `object`, else `list.data.object` / `form.data.object`)',
    alsoRefused: ' — the artifact/HMR loader refuses this same document',
  }));
}

/**
 * Judge one view body at the runtime SAVE door: the refusal when it is an
 * aggregated container whose own `name` disagrees with the name it is saved
 * under, else `undefined`. Call it before the door stamps a missing `name`.
 *
 * @param container The request's view body.
 * @param saveName  The name the door files the row under (`request.name`).
 */
export function savedViewContainerNameRefusal(
  container: unknown,
  saveName: string,
): ViewContainerNameRefusal | undefined {
  return judge(container, saveName, () => ({
    subject: 'view container',
    key: 'the name it is saved under',
    keyDetail: '',
    alsoRefused: '',
  }));
}
