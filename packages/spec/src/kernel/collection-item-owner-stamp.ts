// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010] The owner-stamp judge for a collection item's `_packageId`: ONE
 * comparison and ONE set of words, called by every door that files a
 * collection item under a package.
 *
 * ## The rule
 *
 * `_packageId` is the ADR-0010 envelope stamp: the package that REGISTERS the
 * item, written by the registration (`applyProtection`, which writes the key
 * only while it is unset). Every item schema that spreads
 * `MetadataProtectionFields` declares the key, so a body could arrive wearing
 * another package's id, or an id no package holds, and keep it: every reader
 * that asks an item's owner (whose package root a connector's file ref
 * resolves against, the disabled-package filter, the artifact gates) then read
 * a stamp the body wrote about itself. A body never names its own owner, so
 * the stamp is refused, with a prescription.
 *
 * | body `_packageId` | the owner | verdict |
 * |:--|:--|:--|
 * | absent (`undefined`) | anything | accepted: an absent key declares nothing |
 * | `'P'` | `'P'` | accepted: what an item re-registered under its own package carries |
 * | `'Q'` | `'P'` | refused |
 * | any value, `null` and `''` included | none | refused |
 * | `null` or `''` | `'P'` | refused: `applyProtection` overwrites neither, so either would survive as an owner no row answers |
 *
 * The comparison is strict equality against the owner as the door passes it:
 * the registration door's own normalisation (`id || name`) is the door's, and
 * a stamp of another type than string is judged like any other foreign value
 * (the build door's item schemas refuse it first, with their own located
 * issue, since `_packageId` is declared `z.string()`).
 *
 * ## The doors, and why the judge lives in this package
 *
 * | door | caller | the owner it passes |
 * |:--|:--|:--|
 * | `build` | the stack schema's refinement (`ObjectStackDefinitionSchema`, `stack.zod.ts`): `defineStack`, `os validate`, `os build`, the artifact door's parse | the stack's `manifest.id` (none without a manifest); each `packages[]` body's own `id` |
 * | `register` | `ObjectQL.registerApp`'s collection loop, its seed datasets and its `viewItems:` channel, and the `manifest` service's residual registration (`@objectstack/objectql`) | the package id it registers under |
 *
 * `@objectstack/spec` is the one layer both callers already depend on, so the
 * judge lives here and nowhere else. ⛔ Do not write a second comparison at a
 * door: two doors spelling one rule differently is how one comes to accept
 * what the other refuses. What stays at the registration door is process
 * state, not a body rule: a stamp a registration of this process wrote onto
 * the caller's own object is exempt there, because no body wrote it.
 *
 * ## Which collections
 *
 * {@link OWNER_STAMP_JUDGED_COLLECTIONS}: the stack collections whose items the
 * registration door files through `registerItem` and judges, the seed `data`
 * datasets included. The build door judges exactly these, so it refuses what
 * the boot refuses and nothing the boot accepts. An objectql test holds the
 * list equal to what `registerApp` refuses, key by key.
 *
 * ## The words
 *
 * Pure: it builds no error and throws nothing. Each door wraps
 * {@link CollectionItemOwnerStampRefusal} in its own envelope: the build door
 * as a schema issue at the item's `_packageId`, the registration door as
 * ADR-0112's `VALIDATION_ERROR` / 400 with `issues[]` at `_packageId`. The
 * message prescribes first, because a 4xx message crosses the REST boundary
 * bounded at 500 characters with its tail truncated. The two doors' words
 * differ only in the clause that names where the owner comes from. Runtime
 * words carry no tracker number.
 */

/** The door judging the item: where its owner comes from. */
export type CollectionItemOwnerStampDoor = 'build' | 'register';

/** A disagreement, in the words every door shows it with. */
export interface CollectionItemOwnerStampRefusal {
  /** The body's `_packageId`, as it arrived (never `undefined`). */
  readonly stamped: unknown;
  /** The owner judged against: `undefined` is no package. */
  readonly owner: string | undefined;
  /** The refusal sentence: the prescription first, then both values, then the rule. */
  readonly message: string;
  /** The located sentence a door's issue at `_packageId` carries. */
  readonly issueMessage: string;
}

/**
 * The stack collections whose items the registration door files under their
 * package and judges by {@link judgeCollectionItemOwnerStamp}, in the stack
 * schema's spelling.
 *
 * Not judged, because the registration door files them through a path of its
 * own and does not judge their stamp: `objects` and `objectExtensions` (the
 * object-merge path), `apps` (registered by their own verb),
 * `picklistExtensions` (merged into the list they name, not filed as items),
 * and `datasources`, `datasourceMapping` and `translations` (configuration,
 * not registry items).
 */
export const OWNER_STAMP_JUDGED_COLLECTIONS = Object.freeze([
  'picklists',
  'actions', 'views', 'pages', 'dashboards', 'reports', 'datasets',
  'flows', 'webhooks', 'jobs',
  'positions', 'permissions', 'capabilities', 'sharingRules',
  'queues', 'assignmentRules',
  'agents', 'tools', 'skills',
  'apis',
  'hooks', 'mappings', 'analyticsCubes',
  'connectors',
  'emailTemplates', 'docs', 'books',
  'data',
] as const);

/** One member of {@link OWNER_STAMP_JUDGED_COLLECTIONS}. */
export type OwnerStampJudgedCollection = (typeof OWNER_STAMP_JUDGED_COLLECTIONS)[number];

/**
 * Judge one collection item's body `_packageId` against the owner of the door
 * that files it.
 *
 * @param item  The item's body, as it arrived (anything: a non-object is not judged).
 * @param type  The item's metadata type, as the words show it (`connector`, `data`, …).
 * @param name  The item's name, as the words show it.
 * @param owner The package the door files the item under: `undefined` for none.
 * @param door  Which door is asking (see the module header).
 * @returns The refusal when the stamp disagrees with the owner, else `undefined`.
 */
export function judgeCollectionItemOwnerStamp(
  item: unknown,
  type: string,
  name: string,
  owner: string | undefined,
  door: CollectionItemOwnerStampDoor,
): CollectionItemOwnerStampRefusal | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const stamped = (item as { _packageId?: unknown })._packageId;
  if (stamped === undefined || stamped === owner) return undefined;
  const where = door === 'register'
    ? `it is registered under ${owner === undefined ? 'no package' : `package '${owner}'`}`
    : `this stack ships it from ${owner === undefined ? 'no package (the stack declares no `manifest`)' : `package '${owner}'`}`;
  const issueMessage = `carries _packageId ${JSON.stringify(stamped)}, but ${where}`;
  return {
    stamped,
    owner,
    message: `Drop \`_packageId\` from ${type} '${name}': it ${issueMessage}. The package an item belongs to is the one `
      + 'that registers it, stamped by the registration; a body never names its own owner.',
    issueMessage,
  };
}
