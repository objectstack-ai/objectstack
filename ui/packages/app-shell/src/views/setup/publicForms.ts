// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Configuration → Public forms (objectstack#36444): the operations
 * half of public forms. Studio designs a public form; Setup lists every public
 * form of the environment and switches it on or off, copies its address and
 * opens it.
 *
 * ## Which forms are listed, and which are on
 *
 * A public form is a form view item whose form the server's one rule
 * (`anonymousFormIntakeCandidates`, `@objectstack/spec/ui`) opens to anonymous
 * intake. The rule reads three keys of its `sharing`: the switch `enabled`,
 * `allowAnonymous` and the `publicLink` slug. This module reads none of them
 * itself (the routes and this page must never disagree, objectui#11545):
 *
 * - a form is ON when the rule opens it as served;
 * - a form is LISTED when the rule would open it with its switch on, so a
 *   switched-off form stays in the list and can be switched back on. A form
 *   whose author never made it anonymous or gave it no address is an internal
 *   form, and is not listed.
 *
 * The list read is the effective one (`GET /meta/view`, ADR-0146 D8): an
 * installed app's form switched off in its customization package is served
 * switched off, so it lists as off.
 *
 * ## Where a switch is saved
 *
 * The switch is the form's `sharing.enabled`, saved and published at once,
 * where the console's other in-place edits save (the dashboard editor's
 * targets, `runtime-metadata-persistence.ts`):
 *
 * - a form of a writable package is saved in that package;
 * - a form of an installed (read-only) app is saved as this environment's
 *   customization: an override in the app's `.custom` package (ADR-0146 D2/D3),
 *   never an edit of the app's own package, so the app upgrades as before.
 *   Switching such a form back on removes the override when the override held
 *   nothing but the switch ("Restore package original"), so the app's own form,
 *   upgrades included, is served again. An override that also carries design
 *   changes keeps them, with the switch turned on.
 *
 * A switch is refused, and nothing is written, over a draft already pending
 * where it would save: that draft is its saver's and is never published on
 * their behalf.
 *
 * Not listed here: when a form last took a submission. A submission is an
 * ordinary record of the form's object and records no form, so there is
 * nothing to read.
 */

import { anonymousFormIntakeCandidates, anonymousFormObjectName } from '@objectstack/spec/ui';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import {
  resolveDashboardEditTarget,
  ensureDashboardSaveTarget,
  saveAndPublishInPackage,
  saveAndPublishRuntimeMetadata,
  type DashboardSaveTargetDoors,
  type RuntimePersistCtx,
  type SaveAndPublishOutcome,
} from '../runtime-metadata-persistence.js';
import { declaredOverrideOf, overrideDraftBody } from '../studio-design/StudioCustomizeControls.js';

type Doc = Record<string, any>;

const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);

/** One public form, as the list read serves it. */
export interface PublicFormRow {
  /** The form view item's name: the metadata address every write names. */
  name: string;
  /** What the page shows as its name ({@link shownName}). */
  title: string;
  /** The object a submission creates a record of. */
  object?: string;
  /** The slug of its address (`/forms/<slug>`). */
  slug: string;
  /** Whether the anonymous routes serve it now. */
  on: boolean;
  /** The package that serves the item (`_packageId`), or `null` when it names none. */
  packageId: string | null;
}

/** `form` with its switch set to `on`: the only key a switch writes. */
function withSwitch(form: Doc, on: boolean): Doc {
  return { ...form, sharing: { ...(isDoc(form.sharing) ? form.sharing : {}), enabled: on } };
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/**
 * The name a form is shown by, in the words its author gave it: the served
 * (translated) label, else the form's title or label, else the label of its
 * first section (what the form's own page heads it with), else its name
 * without the object prefix (`crm_lead.web_to_lead` → `web_to_lead`).
 */
function shownName(item: Doc): string {
  const config: Doc = isDoc(item.config) ? item.config : {};
  const first = Array.isArray(config.sections) ? config.sections.find(isDoc) : undefined;
  const dot = item.name.lastIndexOf('.');
  return (
    text(item.label) ??
    text(config.title) ??
    text(config.label) ??
    text(first?.label) ??
    (dot >= 0 && dot < item.name.length - 1 ? item.name.slice(dot + 1) : item.name)
  );
}

/**
 * The public form a served view item carries, or `null` (module header): a
 * `viewKind: 'form'` item whose `config` the rule opens once its switch is on.
 * The list serves view ITEMS only, so a form is its item's `config`.
 */
export function publicFormRowOf(item: unknown): PublicFormRow | null {
  if (!isDoc(item) || item.viewKind !== 'form' || !isDoc(item.config) || typeof item.name !== 'string') return null;
  const switchedOn = anonymousFormIntakeCandidates({ ...item, config: withSwitch(item.config, true) });
  const listed = switchedOn.find((c) => c.key === item.name);
  if (!listed) return null;
  const on = anonymousFormIntakeCandidates(item).some((c) => c.key === item.name);
  const packageId = typeof item._packageId === 'string' && item._packageId ? item._packageId : null;
  return {
    name: item.name,
    title: shownName(item),
    object: anonymousFormObjectName(item, item.config),
    slug: listed.slug,
    on,
    packageId,
  };
}

/** Every public form of a `GET /meta/view` answer (`{ items }`, or a bare array), sorted by name shown. */
export function publicFormRowsOf(answer: unknown): PublicFormRow[] {
  const items: unknown[] = Array.isArray(answer) ? answer : isDoc(answer) && Array.isArray(answer.items) ? answer.items : [];
  const rows: PublicFormRow[] = [];
  for (const item of items) {
    const row = publicFormRowOf(item);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name));
}

/** The metadata client calls {@link switchPublicForm} makes. */
export interface PublicFormSwitchClient {
  layered(
    type: string,
    name: string,
    options?: { packageId?: string },
  ): Promise<{ code?: unknown; effective?: unknown; draft?: unknown }>;
  save(type: string, name: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>;
  publish(type: string, name: string, options?: Record<string, unknown>): Promise<unknown>;
  reset(type: string, name: string, options?: Record<string, unknown>): Promise<unknown>;
}

/** What a switch did. */
export type PublicFormSwitchOutcome = SaveAndPublishOutcome | 'restored';

/** A switch the console refuses before writing anything. */
export class PublicFormSwitchRefusal extends Error {
  constructor(
    readonly reason: 'no-package' | 'no-version' | 'load-failed',
    detail?: string,
  ) {
    super(detail ?? reason);
    this.name = 'PublicFormSwitchRefusal';
  }
}

/** A document without the read's `_` decorations. */
function authored(doc: Doc): Doc {
  const out: Doc = {};
  for (const [key, value] of Object.entries(doc)) if (!key.startsWith('_')) out[key] = value;
  return out;
}

/** `JSON.stringify` with sorted keys: two documents that say the same thing compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    isDoc(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/**
 * Whether the override `override` of `base`'s form says nothing but the switch:
 * the two are the same once the declaration, the read's decorations and the
 * switch are set aside.
 */
export function overrideHoldsOnlySwitch(override: Doc, base: Doc): boolean {
  const strip = (doc: Doc) => {
    const out = authored(doc);
    delete out.overrides;
    if (isDoc(out.config)) out.config = withSwitch(out.config, true);
    return out;
  };
  return canonical(strip(override)) === canonical(strip(base));
}

/**
 * Switch the public form `row` on or off for everyone at once (module header).
 * Resolves what was done; rejects with the server's refusal, or with a
 * {@link PublicFormSwitchRefusal} when nothing could be written.
 */
export async function switchPublicForm(
  row: Pick<PublicFormRow, 'name' | 'packageId' | 'object'>,
  on: boolean,
  client: PublicFormSwitchClient,
  ctx: Omit<RuntimePersistCtx, 'metadataClient'>,
  doors?: DashboardSaveTargetDoors,
): Promise<PublicFormSwitchOutcome> {
  const target = await resolveDashboardEditTarget(row.packageId, doors);
  if (target.kind === 'refused') throw new PublicFormSwitchRefusal('no-package', target.reason);
  const persist: RuntimePersistCtx = { ...ctx, metadataClient: client, objectName: row.object ?? null };

  // The address the form is read at: its package, the app's pair when the
  // package list lists one (it then serves the override, if any, and the
  // base's own document as `code`), else the base.
  const at =
    target.kind === 'unbound'
      ? {}
      : target.kind === 'package'
        ? { packageId: target.packageId }
        : { packageId: target.pair ?? target.base };
  let layers: { code?: unknown; effective?: unknown; draft?: unknown };
  try {
    layers = await client.layered('view', row.name, at);
    // A listed pair that does not hold the form yet holds nothing: its base's document is read.
    if (target.kind === 'customization' && target.pair && !isDoc(layers.effective) && !isDoc(layers.code)) {
      layers = await client.layered('view', row.name, { packageId: target.base });
    }
  } catch (err) {
    throw new PublicFormSwitchRefusal('load-failed', err instanceof Error ? err.message : String(err));
  }
  const effective = isDoc(layers.effective) ? layers.effective : isDoc(layers.code) ? layers.code : null;
  if (!effective || !isDoc(effective.config)) throw new PublicFormSwitchRefusal('load-failed', row.name);
  const switched = { ...authored(effective), config: withSwitch(effective.config, on) };

  if (target.kind === 'unbound') return saveAndPublishRuntimeMetadata('view', row.name, switched, persist);
  if (target.kind === 'package') return saveAndPublishInPackage('view', row.name, switched, target.packageId, persist);

  // An installed app: this environment's customization, in the app's pair.
  const override = declaredOverrideOf(effective, target.base) ? effective : null;
  const base = isDoc(layers.code) ? layers.code : null;
  if (on && override && base && isDoc(base.config)) {
    const baseOn = anonymousFormIntakeCandidates(base).some((c) => c.key === row.name);
    if (baseOn && overrideHoldsOnlySwitch(override, base) && target.pair) {
      // A draft pending over the override is its saver's: nothing is removed under it.
      if (isDoc(layers.draft)) return 'pending-draft';
      // "Restore package original": the pair's row of the form is removed.
      await client.reset('view', row.name, { packageId: target.pair });
      if (row.object) persist.dataSource?.invalidateViewKeys?.(row.object, row.name);
      emitMetadataRefresh();
      return 'restored';
    }
  }
  const body = overrideDraftBody(switched, target.base, target.basedOn);
  if (body === null) throw new PublicFormSwitchRefusal('no-version', target.base);
  const saveTarget = await ensureDashboardSaveTarget(target, doors);
  if (saveTarget.kind !== 'customization') throw new PublicFormSwitchRefusal('no-package', target.base);
  return saveAndPublishInPackage('view', row.name, body, saveTarget.packageId, persist);
}
