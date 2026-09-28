// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The divergent view-container `name` refusal — ONE judge, called by the boot
 * registrar and by `os validate`.
 *
 * ## What it judges
 *
 * An aggregated `defineView` container is registered under the OBJECT it
 * binds to, not under its own `name` (`resolveMetadataItemName` in
 * `engine.ts`). A container whose own `name` is set and differs from that
 * derived key is refused: resolving the disagreement silently in either
 * direction files the item under a key the author never wrote (#7378 row 1).
 * The boot loop adopted the refusal under the #14666 ruling (maintainer,
 * 2026-09-03, direction 2), converging onto the artifact/HMR loader, which
 * already refused the same document.
 *
 * ## Why this is a module and not a block inside `registerMetadataCollections`
 *
 * `os validate` is the author-time judge of what the runtime will accept. It
 * used to pass this document (exit 0) while `os serve` refused it at boot
 * (#20331). The fix is the SAME judgment at both doors, in the same words —
 * not a second rule that agrees with the first only until one of them is
 * edited. So the check moved here, byte for byte, and the boot loop throws
 * what this returns; the CLI reports it.
 *
 * ## Why it derives the key itself instead of taking it
 *
 * For a container, the key boot registers under IS
 * {@link deriveViewContainerObject} — the first branch of
 * `resolveMetadataItemName` returns exactly that, gated on the same
 * {@link isAggregatedViewContainer}. Taking the key as a parameter would make
 * every other caller re-derive it, which is a second spelling of "which
 * derivation does boot use for a container" — the drift this module exists to
 * close. Deriving here keeps one answer for both doors.
 *
 * The gate is two of the three narrowings the ruling named as load-bearing;
 * the third, `key === 'views'`, stays at the call site, because only the
 * `views:` collection carries containers:
 *   * {@link isAggregatedViewContainer} — the CONTAINER branch only. A
 *     standalone ViewItem's `name` is its identity, not a binding;
 *   * `name` present AND different. A container with no `name` is untouched;
 *     so is one whose `name` already equals the derived key, and one that
 *     declares no binding anywhere else, because the derivation then falls
 *     back to that same `name` and cannot disagree with itself.
 *
 * The runtime string carries NO tracker id: it is read by authors and
 * operators who cannot resolve one (`check:doc-authoring`). The envelope is
 * the artifact door's — `VALIDATION_ERROR` / 400 — asserted equal to it in
 * `view-container-divergent-name-registrars.test.ts`.
 */

import { isAggregatedViewContainer } from '@objectstack/spec';
// The LEAF subpath, for the reason `engine.ts` states at its own import (#14680).
import { deriveViewContainerObject } from '@objectstack/metadata/view-container';

/** The refusal, in the ADR-0112 envelope the boot registrar throws it in. */
export interface ViewContainerNameRefusal extends Error {
  code: 'VALIDATION_ERROR';
  status: 400;
  httpStatus: 400;
}

/**
 * Judge one `views:` entry: the refusal when it is an aggregated container
 * whose own `name` disagrees with the object key it binds to, else
 * `undefined`.
 *
 * Pure: it throws nothing and registers nothing. The boot registrar throws
 * what it returns; `os validate` reports it.
 *
 * @param container   One entry of a `views:` collection.
 * @param sourceLabel The words naming the source, as the boot registrar
 *   names it (`manifest`, `nested plugin`).
 * @param ownerId     The owning package id the boot registrar stamps.
 */
export function viewContainerNameRefusal(
  container: unknown,
  sourceLabel: string,
  ownerId: string | undefined,
): ViewContainerNameRefusal | undefined {
  if (!isAggregatedViewContainer(container)) return undefined;
  const name = (container as { name?: unknown }).name;
  if (typeof name !== 'string' || !name) return undefined;
  const itemName = deriveViewContainerObject(container);
  if (name === itemName) return undefined;
  const err = new Error(
    `Invalid \`views:\` container from ${sourceLabel} '${ownerId}': the container's own `
    + `\`name\` is '${name}', which disagrees with the object key it binds to, `
    + `'${itemName}' (derived from its own \`object\`, else \`list.data.object\` / `
    + '`form.data.object`). A disagreement is almost always an authoring bug, and resolving '
    + 'it silently in either direction can file the item under a key the caller never wrote '
    + '(refuse loudly, locate the mismatch) — the artifact/HMR loader refuses '
    + 'this same document. Register under one name: drop `name`, or set it to '
    + `'${itemName}'.`,
  ) as ViewContainerNameRefusal;
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  return err;
}
