// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/view-container-name` — the divergent `name` refusal:
 * ONE judge, called by every door that files a metadata item under a key.
 *
 * ## What it judges
 *
 * An item's own `name`, when set, must equal the key the door files the item
 * under. A disagreement is refused: resolving it silently in either direction
 * files the item under a key the author never wrote (#7378 row 1, the rule
 * `IMetadataService.register` states for every type). The maintainer's ruling
 * of 2026-09-03 (direction 2) made the source registrars refuse it for a view
 * container; the runtime save door joined for containers on #21412 (seat
 * answer, Q1 A) and for every type on #21470 (seat answer, Q1 A and Q2 A).
 *
 * The doors differ in WHERE their key comes from, and only there:
 *
 *  - **The source registrars** — the ObjectQL boot loop, `os validate` /
 *    `os compile` (the same judge, through `@objectstack/objectql`) and the
 *    artifact/HMR loader (`plugin.ts`) — file a view container under the
 *    object it binds to, so their key is DERIVED: {@link viewContainerNameRefusal}.
 *  - **The runtime write doors** of `@objectstack/metadata-protocol` file a
 *    `sys_metadata` row under the name the request names, and register the
 *    row's body under the body's own `name` — so the two must agree, for every
 *    type: {@link savedItemNameRefusal}. Three doors write a row:
 *      - `save` — `saveMetaItem`, which REST `PUT /meta/:type/:name` and the
 *        dispatcher both call. Its key is the save name, which for a view
 *        container is not always the binding: the door keeps a container saved
 *        under a name other than its object (#13407) and expands one on
 *        another package's object under its own name (#21334);
 *      - `restore` — `rollbackMetaItem` and `revertCommit`, which write a
 *        stored history version back as the active row;
 *      - `publish` — the draft promotion `publishMetaItem` and
 *        `publishPackageDrafts` share, which writes a stored draft as the
 *        active row.
 *    A body stored before the save door judged every type reaches the last
 *    two without passing the first; that is why they judge too.
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
 * derivation does a source registrar use" — so that entry keeps deriving. A
 * write door's key is not a derivation at all; it is the request's own name,
 * which is why that entry takes it.
 *
 * ## What counts as SET
 *
 *   * The derived entry judges the CONTAINER branch only
 *     ({@link isAggregatedViewContainer}): a standalone ViewItem's `name` is
 *     its identity, not a binding. A `name` is set when it is a non-empty
 *     string; a falsy derived key refuses nothing, because the boot loop warns
 *     and skips an entry whose derived key is falsy, and
 *     `deriveViewContainerObject`'s `??` chain can keep `''`
 *     (`list: { data: { object: '' } }`), so a door that calls this alone
 *     cannot refuse what boot skips.
 *   * The write-door entry judges every type, with row 1's own predicate: a
 *     `name` is set when the body carries one at all (`!== undefined`) —
 *     `''`, `null` and a non-string included, because the registry keys the
 *     body by `String(name)` whatever it is (measured: a `translation` body's
 *     schema accepts `name: ''`, and a type with no schema accepts anything).
 *     ONE exception, and it is the door's, not the type's: the save door
 *     STAMPS a missing view name (`normalizeViewMetadata`, after this judge),
 *     and a falsy one is missing to it — so for a `view` at the `save` door a
 *     `name` is set only when it is a non-empty string. A truthy non-string
 *     view `name` is the view schema's to refuse (measured: 422). The restore
 *     and publish doors stamp nothing, so they take row 1's predicate for
 *     views too.
 *
 * ## The words
 *
 * One template; each door supplies only where its key came from and what the
 * author can do about it ({@link KeyOrigin}). The source registrars' rendering
 * is byte for byte the words the boot loop and `os validate` have always
 * printed, and the save door's rendering for a view container is byte for byte
 * the words it printed before every type joined. The remedy is true per door
 * and per type (`remediesFor`): "drop `name`" only where that works (a view,
 * whose missing name the save door stamps; a `field`, whose row name its
 * column `name` cannot spell); "set `name`", or save under the body's own
 * name, everywhere else; and at the restore and publish doors, which write a
 * stored body the caller cannot edit in place, the save that fixes it. The
 * runtime string carries NO tracker id
 * (`check:doc-authoring`). The envelope is ADR-0112's `VALIDATION_ERROR` /
 * 400 at every door.
 *
 * ## Why a subpath of its own
 *
 * `@objectstack/metadata` is the one layer every door already depends on
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
 * Where a door's key came from and what fixes the disagreement — the only
 * words that differ between doors. `subject` names the item and its source,
 * `owner` whose `name` it is, `key` what the key is, `keyDetail` follows the
 * key, `alsoRefused` follows the shared reason, and `remedy` follows
 * "Register under one name: ".
 */
interface KeyOrigin {
  subject: string;
  owner: string;
  key: string;
  keyDetail: string;
  alsoRefused: string;
  remedy: string;
}

/** The owner words of a view container — the words every door printed before every type joined. */
const CONTAINER_OWNER = "the container's";

/** The remedy where the door stamps a missing `name`: the words the container doors always printed. */
const stampedRemedy = (key: string): string => `drop \`name\`, or set it to '${key}'`;

/** A `name` as the words show it: quoted when it is a string, its JSON otherwise. */
function shown(name: unknown): string {
  return typeof name === 'string' ? `'${name}'` : String(JSON.stringify(name));
}

function refusal(name: unknown, key: string, origin: KeyOrigin): ViewContainerNameRefusal {
  const err = new Error(
    `Invalid ${origin.subject}: ${origin.owner} own `
    + `\`name\` is ${shown(name)}, which disagrees with ${origin.key}, `
    + `'${key}'${origin.keyDetail}. A disagreement is almost always an authoring bug, and resolving `
    + 'it silently in either direction can file the item under a key the caller never wrote '
    + `(refuse loudly, locate the mismatch)${origin.alsoRefused}. Register under one name: ${origin.remedy}.`,
  ) as ViewContainerNameRefusal;
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  return err;
}

/**
 * The judgement every door shares: a SET own `name` (each entry decides what
 * set means for its door, see the header) that is not the key. A falsy key
 * refuses nothing.
 */
function judge(
  name: unknown,
  key: string | undefined,
  origin: (key: string) => KeyOrigin,
): ViewContainerNameRefusal | undefined {
  if (!key) return undefined;
  if (name === key) return undefined;
  return refusal(name, key, origin(key));
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

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
  if (!isAggregatedViewContainer(container)) return undefined;
  const name = (container as { name?: unknown }).name;
  if (!isNonEmptyString(name)) return undefined;
  return judge(name, deriveViewContainerObject(container), (key) => ({
    subject: `\`views:\` container from ${sourceLabel} '${ownerId}'`,
    owner: CONTAINER_OWNER,
    key: 'the object key it binds to',
    keyDetail: ' (derived from its own `object`, else `list.data.object` / `form.data.object`)',
    alsoRefused: ' — the artifact/HMR loader refuses this same document',
    remedy: stampedRemedy(key),
  }));
}

/**
 * Judge one metadata body at a runtime WRITE door, for every type: the
 * refusal when its own `name` is set and disagrees with the name the door
 * writes the row under, else `undefined`. Pure: it throws nothing and writes
 * nothing; the door throws what it returns, before anything is stored or
 * registered.
 *
 * @param type     The canonical (singular) metadata type the door writes.
 * @param item     The body the door is about to write.
 * @param saveName The name the door writes the row under (`request.name`).
 * @param door     Which door writes it: `save` (`saveMetaItem`, which stamps
 *   a missing view `name` after this call), `restore` (`rollbackMetaItem`,
 *   `revertCommit`) or `publish` (the draft promotion). It decides what counts
 *   as set and which remedy is true — see the header.
 */
export function savedItemNameRefusal(
  type: string,
  item: unknown,
  saveName: string,
  door: 'save' | 'restore' | 'publish',
): ViewContainerNameRefusal | undefined {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
  const name = (item as { name?: unknown }).name;
  const isView = type === 'view';
  const stampsMissingName = door === 'save' && isView;
  if (stampsMissingName ? !isNonEmptyString(name) : name === undefined) return undefined;
  const container = isView && isAggregatedViewContainer(item);
  const noun = container ? 'view container' : type;
  const owner = container ? CONTAINER_OWNER : 'its';
  return judge(name, saveName, (key) => {
    const remedies = remediesFor(type, name, key);
    if (door === 'save') {
      return { subject: noun, owner, key: 'the name it is saved under', keyDetail: '', alsoRefused: '', remedy: remedies.save };
    }
    return door === 'restore'
      ? {
        subject: `${noun} version`,
        owner,
        key: 'the name it is restored under',
        keyDetail: '',
        alsoRefused: '',
        remedy: `save the item ${remedies.saveWith}, instead of restoring this version`,
      }
      : {
        subject: `${noun} draft`,
        owner,
        key: 'the name it is published under',
        keyDetail: '',
        alsoRefused: '',
        remedy: `save the draft again ${remedies.saveWith}, then publish it`,
      };
  });
}

/**
 * The fix that is TRUE for this type, said two ways: as the save door's
 * remedy, and as the "with …" clause of the save the restore and publish doors
 * prescribe (their caller cannot edit a stored version or draft in place).
 *
 *  - `view`: the save door stamps a missing name, so dropping it works — the
 *    words the container doors always printed.
 *  - `field`: a `field` row is named `object.field`, and `FieldSchema` keeps
 *    the column `name` dot-free, so the save name can never be its `name`;
 *    the schema does not require one, so dropping it is the fix (measured).
 *  - every other type: set `name` to the save name, or — when the body's own
 *    `name` is a name at all — save the item under it instead. Both are
 *    offered because a save name the type's schema cannot spell (a dotted
 *    name, where the schema forbids the dot) leaves only the second.
 */
function remediesFor(type: string, name: unknown, key: string): { save: string; saveWith: string } {
  if (type === 'view') {
    return { save: stampedRemedy(key), saveWith: `with \`name\` dropped or set to '${key}'` };
  }
  if (type === 'field') {
    return {
      save: 'drop `name` (a `field` row is named object.field, which its column `name` cannot spell)',
      saveWith: 'with `name` dropped',
    };
  }
  return isNonEmptyString(name)
    ? { save: `set \`name\` to '${key}', or save the item under '${name}'`, saveWith: `with \`name\` set to '${key}', or under '${name}'` }
    : { save: `set \`name\` to '${key}'`, saveWith: `with \`name\` set to '${key}'` };
}

