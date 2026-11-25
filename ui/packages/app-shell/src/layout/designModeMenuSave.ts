// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind the design mode's 「Save」 for the app's menu
 * (objectstack#36363): the app document with its new `navigation`, written
 * where Studio's menu editing writes it and published at once, so everyone
 * sees it.
 *
 * Where it is written is Studio's rule (`StudioDesignSurface`'s nav save,
 * objectstack#30059, ADR-0146 D2/D3): the app's own package when the server
 * lists it writable, else the base's paired customization package, asked of
 * the ensure door (which creates it on first use and names it), the body
 * declaring the override of the base at the base's listed version
 * (`overrideDraftBody`). An installed app's menu is thereby a customization
 * of this environment, as Studio's is.
 *
 * What is written is the app as STORED, never as served (objectstack#36363,
 * review 7081226692): the served app is translated for the reader's language
 * (`translateApp`) and pruned of entries the reader may not open
 * (`filterNav`), so writing it back would store the reader's language on
 * every label and drop what the reader was not shown. The stored app is the
 * layered read (`/layers`, which serves a caller who may write the app its
 * stored version, unpruned and untranslated), and the menu edits are
 * replayed on its navigation by entry id (`rebaseMenuEdits`); an entry
 * naming no target is left out (`navPayloadOf`, as Studio's nav save).
 *
 * The order written is the order the editor showed (objectstack#36591). The
 * sidebar sorts each level by `order`, so the editor shows each level, and the
 * edits are replayed on each stored level, in that order (`inShownOrder`);
 * each level whose entries carry `order` then has it rewritten from the
 * result's order (`withOrderRewritten`). A level with no `order` is saved by
 * array order alone, as before.
 *
 * Nothing is created before every check has passed: the base's version is
 * read before the customization package is asked for, and a pair the server
 * does not list writable is refused before anything is written to it.
 *
 * How it is written is the runtime's confirmed-save rule
 * (`saveAndPublishRuntimeMetadata`, objectstack#35955): the draft is written
 * with the first-write pin, so a draft somebody left pending (in Studio, say)
 * is refused, never overwritten nor published on its saver's behalf, and the
 * refusal is said; a publish the server refuses discards the draft this save
 * wrote. A landed publish announces itself (`emitMetadataRefresh`), and the
 * console re-reads the app, its menu included.
 *
 * The publish is pinned to the published row the save was composed from
 * (objectstack#36538, the `/layers` read's `overlayVersion`, objectstack#36601):
 * a publish somebody else lands between the read and this save's publish is
 * refused `409`, the draft is discarded, and the bar says so, never written
 * over. The pin is read at the address the publish writes (`publishPinAt`),
 * before the body is read, so a publish in between pairs an old pin with a
 * new body and is refused, the safe direction.
 *
 * A stored read that holds no app (the layered read answers a 404 as an
 * empty view) refuses the save (objectstack#36538): nothing served is
 * written, and the stored app's own keys are never dropped.
 *
 * A name typed outside the app's source language is that language's
 * translation, never the stored label (objectstack#36504): the stored labels
 * are the app's own text, read in every language that has no translation.
 * The source language is the one `GET /i18n/locales` names (`sourceLocale`,
 * the declared `i18n.sourceLocale` else the default locale). Such a name, and
 * one typed in the source language over a translation the reader was shown,
 * is written to the `translation` item `APP_menu_LOCALE` in the package the
 * menu is written to (`menuTranslationName`), at the key app navigation is
 * translated by (`apps.APP.navigation.ID.label`, `translateApp`): on an
 * installed app that is its customization package, whose own translations
 * come first (ADR-0146 D2). An entry added with a name typed outside the
 * source language is stored without one, and its name is its translation;
 * the source language names it when someone sets it there. The translation
 * is written before the menu, and alone when it is all the save holds.
 *
 * @module
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { isDraftVersionConflict, publishedPinOf, type DraftPin } from '../views/metadata-admin/DraftConflictDialog.js';
import { overrideDraftBody } from '../views/studio-design/StudioCustomizeControls.js';
import {
  ensureCustomizationPackage,
  fetchListedPackageManifests,
  listedCustomizationPairOf,
  listedPackageVersion,
  type EnsuredCustomizationPackage,
  type ListedPackageManifest,
} from '../views/studio-design/packages-io.js';
import { navPayloadOf } from '../views/metadata-admin/previews/AppNavCanvas.js';
import {
  inShownOrder,
  rebaseMenuEdits,
  splitLabelEdits,
  storedEntriesById,
  withOrderRewritten,
  type Menu,
  type MenuLabelLanguage,
} from './designModeMenuModel.js';
import { createAuthenticatedFetch } from '@object-ui/auth';

/** The console's authenticated fetch: the stored bearer token beside the session cookie. */
function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return createAuthenticatedFetch()(input, init);
}

/** The doors the save goes through; the defaults are the console's own. */
export interface AppMenuSaveDoors {
  readonly listPackages: () => Promise<ReadonlyMap<string, ListedPackageManifest>>;
  readonly ensureCustomization: (basePackageId: string) => Promise<EnsuredCustomizationPackage>;
  /**
   * The deployment's languages (`GET /i18n/locales`, {@link fetchDeploymentLocales}),
   * read when a save routes labels by language (objectstack#36504). Absent,
   * the language is unknown, and every typed label is a translation.
   */
  readonly readLocales?: () => Promise<DeploymentLocales | null>;
  readonly client: {
    layered: (type: string, name: string, options: { packageId?: string }) => Promise<unknown>;
    save: (type: string, name: string, body: unknown, options: Record<string, unknown>) => Promise<unknown>;
    publish: (type: string, name: string, options: { packageId?: string; ifMatch?: string; ifNoneMatch?: '*' }) => Promise<unknown>;
    reset: (type: string, name: string, options: Record<string, unknown>) => Promise<unknown>;
  };
}

/** The sentences a refused save is said with, in the viewer's language. */
export interface AppMenuSaveTexts {
  /** The app's package is not one the server lists. */
  readonly notListed: string;
  /** A draft of the app is already pending. */
  readonly pendingDraft: string;
  /** The base's listed manifest states no version to declare the override at. */
  readonly noVersion: string;
  /** The customization package the server answered is not writable. */
  readonly notWritable: string;
  /**
   * The stored read holds no app (objectstack#36538): nothing is written.
   * Absent, said with {@link notListed}.
   */
  readonly storedUnread?: string;
  /**
   * The menu was published by somebody else between this save's read and its
   * publish (objectstack#36538): nothing went live. Absent, the server's
   * refusal is passed on as it came.
   */
  readonly publishedMoved?: string;
  /**
   * A draft of the menu's translation is already pending (objectstack#36504).
   * Absent, said with {@link pendingDraft}.
   */
  readonly translationPendingDraft?: string;
}

/**
 * A menu save's input: the app, the menu the editor was seeded from
 * (`served`), the edited one (`navigation`), and the language its labels
 * were typed in (`labels`, objectstack#36504). Without `labels`, every label
 * edit is written to the stored label.
 */
export interface AppMenuSaveInput {
  readonly appName: string;
  readonly packageId: string;
  readonly served: Menu;
  readonly navigation: Menu;
  readonly labels?: { readonly language: string };
}

/**
 * The menu labels a save writes as one language's translation
 * (objectstack#36504): the `translation` item `name`, for `locale`, holding
 * `apps.APP.navigation.ID.label` for each entry of `labels` (by the id the
 * entry is stored under; `null` drops the entry's label from the item).
 */
export interface MenuTranslationWrite {
  readonly name: string;
  readonly locale: string;
  readonly labels: Readonly<Record<string, string | null>>;
}

/** A document as stored, less what a read adds and what belongs to its package. */
function documentOf(read: unknown): Record<string, unknown> {
  const body = stripReadDecorations((read ?? {}) as Record<string, unknown>) as Record<string, unknown>;
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (!key.startsWith('_')) doc[key] = value;
  return doc;
}

/** The stored app of a layered read: its effective layer (the override folded over the base), else its code. */
function storedApp(layers: unknown): Record<string, unknown> {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown };
  return documentOf(read.effective ?? read.code ?? {});
}

/**
 * Whether a layered read holds a stored app at all ({@link storedApp} reads
 * one): `MetadataClient.layered` answers a 404 as a view with every layer
 * `null`, which holds none (objectstack#36538).
 */
export function holdsStoredApp(layers: unknown): boolean {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown };
  return read.effective != null || read.code != null;
}

/**
 * The pin a publish at the address of the layered read `layers` is sent with
 * (objectstack#36538): the read's `overlayVersion` (`publishedPinOf`), and
 * `If-None-Match: *` for a read that holds no layer at all there (a 404,
 * which the server answers when nothing of the item is stored at that
 * address, so no published row is either). A read from a server that serves
 * no `overlayVersion` pins nothing, as before.
 */
export function publishPinAt(layers: unknown): DraftPin | null {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown; overlay?: unknown };
  if (read.effective == null && read.code == null && read.overlay == null) return { ifNoneMatch: '*' };
  return publishedPinOf(layers);
}

/**
 * The menu save once every check has passed: the package it writes to and
 * the app document it writes there. Nothing has been written yet, save the
 * customization package the ensure door creates on first use.
 */
export interface PreparedAppMenuSave {
  readonly appName: string;
  /**
   * The package the menu is written to: the app's own when the server lists
   * it writable, else its customization package. A thing created in design
   * mode for the menu to open is saved here too (objectstack#36364).
   */
  readonly target: string;
  readonly body: Record<string, unknown>;
  /**
   * The published row of the app at `target` the body was composed over
   * (objectstack#36538), as the pin its publish is sent with; `null` or
   * absent, the publish is not pinned.
   */
  readonly publishPin?: DraftPin | null;
  /**
   * The menu's own edits are written (objectstack#36504): `false` when the
   * save holds label translations only, so the app is not written at all.
   * Absent, it is.
   */
  readonly writesMenu?: boolean;
  /** The labels written as a translation, in `target`, before the menu (objectstack#36504). */
  readonly translation?: MenuTranslationWrite | null;
}

/**
 * Every check of a save of the menu edits that turned `served` (the menu the
 * editor was seeded from) into `navigation`, as the menu of the app `appName`
 * of the package `packageId`, and its body. Throws, in the viewer's language,
 * where the menu cannot be saved; nothing is written then.
 */
export async function prepareAppMenuSave(
  input: AppMenuSaveInput,
  texts: AppMenuSaveTexts,
  doors: AppMenuSaveDoors,
): Promise<PreparedAppMenuSave> {
  const { appName, packageId, served } = input;
  const manifests = await doors.listPackages();
  const listed = manifests.get(packageId);
  if (!listed) throw new Error(texts.notListed);
  // An installed app's menu is published in its customization package: the
  // published row there is read first, before the body (objectstack#36538).
  const listedPair = listed.writable ? null : listedCustomizationPairOf(manifests, packageId);
  const pairPin = listedPair ? publishPinAt(await doors.client.layered('app', appName, { packageId: listedPair })) : null;
  // The app as stored, a customization of an installed app folded in.
  const layers = await doors.client.layered('app', appName, { packageId });
  if (!holdsStoredApp(layers)) throw new Error(texts.storedUnread ?? texts.notListed);
  const stored = storedApp(layers);
  const storedNav = Array.isArray(stored.navigation) ? (stored.navigation as Menu) : [];
  // The stored menu in its shown order, as the editor's is (`inShownOrder`),
  // so the edits land where the editor showed them; the result's order is
  // then written as `order` on each level that carries it (objectstack#36591).
  const shownStored = inShownOrder(storedNav);
  // objectstack#36504: a label typed outside the source language, or over a
  // translation, is that language's translation; the menu stored keeps its
  // labels, and the translation is keyed by the id each entry is stored under.
  let navigation = input.navigation;
  let translation: MenuTranslationWrite | null = null;
  const writtenAs = new Map<string, string>();
  let translated: ReadonlyMap<string, string | null> = new Map();
  if (input.labels) {
    const language = labelLanguageOf(input.labels.language, doors.readLocales ? await doors.readLocales() : null);
    const split = splitLabelEdits(served, navigation, storedEntriesById(served, shownStored), language, input.labels.language);
    navigation = split.navigation;
    translated = split.labels;
    if (translated.size > 0) translation = { name: menuTranslationName(appName, language.locale), locale: language.locale, labels: {} };
  }
  const writesMenu = JSON.stringify(navigation) !== JSON.stringify(served);
  const rebased = rebaseMenuEdits(served, navigation, shownStored, writtenAs);
  if (translation) {
    const labels: Record<string, string | null> = {};
    translated.forEach((label, id) => {
      labels[writtenAs.get(id) ?? id] = label;
    });
    translation = { ...translation, labels };
  }
  const nextNav = withOrderRewritten(navPayloadOf(rebased as unknown[]) as Menu);
  let body: Record<string, unknown> | null = { ...stored, name: appName, navigation: nextNav };
  let target = packageId;
  let publishPin = publishedPinOf(layers);
  if (!listed.writable) {
    body = overrideDraftBody(body, packageId, listedPackageVersion(manifests, packageId));
    if (body === null) throw new Error(texts.noVersion);
    const pair = await doors.ensureCustomization(packageId);
    if (!pair.writable) throw new Error(texts.notWritable);
    target = pair.packageId;
    // The pin read at the pair, when it is the pair answered; a pair this
    // call created holds nothing yet; any other was not read, and is not pinned.
    publishPin = pair.packageId === listedPair ? pairPin : pair.created ? { ifNoneMatch: '*' } : null;
  }
  return { appName, target, body, publishPin, writesMenu, translation };
}

/** Write and publish a prepared menu save ({@link prepareAppMenuSave}). */
export async function writeAppMenu(
  prepared: PreparedAppMenuSave,
  texts: Pick<AppMenuSaveTexts, 'pendingDraft' | 'publishedMoved' | 'translationPendingDraft'>,
  doors: Pick<AppMenuSaveDoors, 'client'>,
): Promise<void> {
  const { appName, target, body, publishPin, translation } = prepared;
  // The translation first (objectstack#36504): a translation the menu refused
  // after it keys an entry the menu does not show yet, which reads as nothing;
  // a menu published before a refused translation would be replayed by the
  // next 「Save」 and its added entries written twice.
  if (translation && Object.keys(translation.labels).length > 0) {
    await writeMenuTranslation(appName, target, translation, texts, doors);
    if (prepared.writesMenu === false) {
      emitMetadataRefresh();
      return;
    }
  }
  try {
    await doors.client.save('app', appName, body, { mode: 'draft', packageId: target, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) throw Object.assign(new Error(texts.pendingDraft), { cause: err });
    throw err;
  }
  try {
    await doors.client.publish('app', appName, { packageId: target, ...(publishPin ?? {}) });
  } catch (err) {
    try {
      await doors.client.reset('app', appName, { state: 'draft', packageId: target });
    } catch (discardErr) {
      console.error('[design-mode] a refused publish left the menu draft pending:', discardErr);
    }
    emitMetadataRefresh();
    // A publish somebody landed since the read: nothing went live.
    if (texts.publishedMoved && isDraftVersionConflict(err)) throw Object.assign(new Error(texts.publishedMoved), { cause: err });
    throw err;
  }
  emitMetadataRefresh();
}

/**
 * Save the menu edits that turned `served` (the menu the editor was seeded
 * from) into `navigation`, as the menu of the app `appName` of the package
 * `packageId`, and publish it.
 */
export async function saveAppMenu(
  input: AppMenuSaveInput,
  texts: AppMenuSaveTexts,
  doors: AppMenuSaveDoors,
): Promise<void> {
  await writeAppMenu(await prepareAppMenuSave(input, texts, doors), texts, doors);
}

/** The console's doors, around `client` (`useMetadataClient()`). */
export function consoleAppMenuDoors(client: AppMenuSaveDoors['client']): AppMenuSaveDoors {
  return {
    listPackages: fetchListedPackageManifests,
    ensureCustomization: ensureCustomizationPackage,
    readLocales: fetchDeploymentLocales,
    client,
  };
}

/** Whether `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `translation` item a menu's labels in `locale` are written to
 * (objectstack#36504): one per app and language, `APP_menu_LOCALE` in the
 * item-name grammar (`crm_menu_zh_cn`), so a save reads and writes the
 * menu's labels of one language of one app and nothing else.
 */
export function menuTranslationName(appName: string, locale: string): string {
  const snake = (text: string) => text.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const name = `${snake(appName)}_menu_${snake(locale)}`;
  return /^[a-z]/.test(name) ? name : `app_${name}`;
}

/**
 * Write the menu labels `write` as the translation of the app `appName` in
 * `target` (objectstack#36504), and publish it: the item as stored, its other
 * keys kept, with `apps.APP.navigation.ID.label` set (or dropped, for
 * `null`) for each label. Translations of app navigation are read by entry
 * id at those keys (`translateApp`), the pair's own first on a customized
 * installed app (ADR-0146 D2), so the reader's language reads the new name
 * and every other language keeps its own.
 *
 * Written by the menu's rule (`writeAppMenu`): the first-write pin, so a
 * pending draft is refused and said; the publish pinned to the row read; a
 * refused publish discards the draft.
 */
async function writeMenuTranslation(
  appName: string,
  target: string,
  write: MenuTranslationWrite,
  texts: Pick<AppMenuSaveTexts, 'pendingDraft' | 'publishedMoved' | 'translationPendingDraft'>,
  doors: Pick<AppMenuSaveDoors, 'client'>,
): Promise<void> {
  const layers = await doors.client.layered('translation', write.name, { packageId: target });
  const stored = holdsStoredApp(layers) ? storedApp(layers) : {};
  const apps = isRecord(stored.apps) ? stored.apps : {};
  const app = isRecord(apps[appName]) ? apps[appName] : {};
  const navigation: Record<string, unknown> = { ...(isRecord(app.navigation) ? app.navigation : {}) };
  for (const [id, label] of Object.entries(write.labels)) {
    if (label === null) delete navigation[id];
    else navigation[id] = { ...(isRecord(navigation[id]) ? navigation[id] : {}), label };
  }
  const body = { ...stored, name: write.name, locale: write.locale, apps: { ...apps, [appName]: { ...app, navigation } } };
  const pin = publishPinAt(layers);
  try {
    await doors.client.save('translation', write.name, body, { mode: 'draft', packageId: target, ifNoneMatch: '*' });
  } catch (err) {
    if (isDraftVersionConflict(err)) {
      throw Object.assign(new Error(texts.translationPendingDraft ?? texts.pendingDraft), { cause: err });
    }
    throw err;
  }
  try {
    await doors.client.publish('translation', write.name, { packageId: target, ...(pin ?? {}) });
  } catch (err) {
    try {
      await doors.client.reset('translation', write.name, { state: 'draft', packageId: target });
    } catch (discardErr) {
      console.error('[design-mode] a refused publish left the menu translation draft pending:', discardErr);
    }
    if (texts.publishedMoved && isDraftVersionConflict(err)) throw Object.assign(new Error(texts.publishedMoved), { cause: err });
    throw err;
  }
}

/**
 * The stored menu of the app `appName` of the package `packageId`: the
 * navigation of its layered read (`storedApp`), `null` when the read fails
 * or holds no app (`holdsStoredApp`, objectstack#36538): an empty menu would
 * read every served entry as another package's.
 * The editor compares an entry's shown label with it to tell a translated
 * label from the stored one (objectstack#36363, ruling (4)).
 */
export async function readStoredMenu(
  appName: string,
  packageId: string,
  client: Pick<AppMenuSaveDoors['client'], 'layered'>,
): Promise<Menu | null> {
  try {
    const layers = await client.layered('app', appName, packageId ? { packageId } : {});
    if (!holdsStoredApp(layers)) return null;
    const stored = storedApp(layers);
    return Array.isArray(stored.navigation) ? (stored.navigation as Menu) : [];
  } catch {
    return null;
  }
}

/**
 * The deployment's languages, as `GET /api/v1/i18n/locales` states them: its
 * locale codes, the default one (`isDefault`), and the source language the
 * app's own text is written in (`sourceLocale`, objectstack#36504; a server
 * that states none is taken to author in its default locale, as before).
 */
export interface DeploymentLocales {
  readonly codes: readonly string[];
  readonly defaultLocale: string | null;
  readonly sourceLocale: string | null;
}

let localesRead: Promise<DeploymentLocales | null> | null = null;

/** The deployment's languages, read once per page load; `null` when the read fails. */
export function fetchDeploymentLocales(): Promise<DeploymentLocales | null> {
  if (localesRead) return localesRead;
  localesRead = (async () => {
    try {
      const res = await authFetch('/api/v1/i18n/locales', { credentials: 'include' });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
      const body = isRecord(json?.data) ? json.data : json;
      const locales = (Array.isArray(body?.locales) ? body.locales : []) as Array<{ code?: unknown; isDefault?: unknown }>;
      const codes = locales.map((l) => l?.code).filter((code): code is string => typeof code === 'string' && code !== '');
      const marked = locales.find((l) => l?.isDefault === true);
      const defaultLocale = typeof marked?.code === 'string' && marked.code ? marked.code : null;
      const source = typeof body?.sourceLocale === 'string' && body.sourceLocale ? body.sourceLocale : null;
      return { codes, defaultLocale, sourceLocale: source ?? defaultLocale };
    } catch {
      return null;
    }
  })();
  return localesRead;
}

/**
 * The deployment's default language, as `GET /api/v1/i18n/locales` marks it
 * (`isDefault`), read once per page load; `null` when the read fails or marks
 * none.
 */
export async function fetchDefaultLocale(): Promise<string | null> {
  return (await fetchDeploymentLocales())?.defaultLocale ?? null;
}

/** Test seam: forget the languages read. Not public. */
export function __resetDefaultLocale(): void {
  localesRead = null;
}

/**
 * Where a label typed in the session language `language` is stored
 * (objectstack#36504): under the deployment's code for that language (the
 * exact tag, else one {@link isSameLanguage} matches, else `language` as
 * given), in the source language when it is the deployment's
 * `sourceLocale`. With the languages unread (`null`), no language is known to
 * be the source: a label is then a translation, which never changes what
 * another language reads.
 */
export function labelLanguageOf(language: string, locales: DeploymentLocales | null): MenuLabelLanguage {
  const codes = locales?.codes ?? [];
  const lower = language.trim().toLowerCase().replace(/_/g, '-');
  const locale =
    codes.find((code) => code.toLowerCase() === lower) ?? codes.find((code) => isSameLanguage(language, code)) ?? language;
  const source = !!locales?.sourceLocale && isSameLanguage(language, locales.sourceLocale);
  return { locale, source };
}

/**
 * Whether the session language `language` is the language `locale`: the same
 * tag, letter case aside, or the same base when either names no region
 * (`en` is `en-US`; `zh-CN` is not `zh-TW`).
 */
export function isSameLanguage(language: string, locale: string): boolean {
  const a = language.trim().toLowerCase().replace(/_/g, '-');
  const b = locale.trim().toLowerCase().replace(/_/g, '-');
  if (!a || !b) return false;
  if (a === b) return true;
  const [baseA, ...restA] = a.split('-');
  const [baseB, ...restB] = b.split('-');
  return baseA === baseB && (restA.length === 0 || restB.length === 0);
}
