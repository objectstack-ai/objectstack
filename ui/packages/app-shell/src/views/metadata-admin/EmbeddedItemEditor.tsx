// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * EmbeddedItemEditor — full-form editor for items that live INSIDE a
 * parent metadata body (e.g. `object.fields.email`).
 *
 * Embedded items don't have their own HTTP endpoint (`PUT /meta/field/email`
 * does NOT exist for object-scoped fields) — so we:
 *   1. Render a SchemaForm using the registered sub-type's schema / form
 *      (e.g. `field` for `object.fields`).
 *   2. On save: re-read the parent (its pending draft when one exists, else
 *      its published body), splice the modified item back under
 *      `parent.<embeddedPath>.<itemName>`, and PUT the parent — into its
 *      draft when the base was the draft (objectui#12027).
 *
 * If the sub-type isn't registered (e.g. `index` has no `editAs`), we
 * fall back to a raw-JSON editor so users can still hand-edit and save.
 *
 * When the sub-type has a registered Preview renderer, it is mounted above the
 * form on the live draft (objectui#4132). Previews used to be reachable only
 * from `ResourceEditPage`'s Preview tab, i.e. only for STANDALONE metadata —
 * which meant `ValidationPreview` rendered only on the standalone `validation`
 * door ADR-0088 retired, and never on `object.validations`, the path the
 * framework actually evaluates. The lookup is generic (`useRegisteredMetadataPreview`),
 * so any embedded sub-type that has a preview gets it; one that has none is
 * unchanged, with no empty preview chrome.
 */

import * as React from 'react';
import { Loader2, Save, AlertTriangle } from 'lucide-react';
import { Button } from '@object-ui/components';
import {
  SchemaForm,
  DRAWER_EMBEDDED_ITEM_ID_SCOPE,
  type SchemaFormIssue,
} from './SchemaForm.js';
import { useRegisteredMetadataPreview } from './preview-registry.js';
import { useMetadataClient, useMetadataTypes } from './useMetadata.js';
import type { FormViewSpec } from './form-spec.js';
import { useMetadataLocale, t, tFormat, translateValidationMessage } from './i18n.js';
import { errorCodeIsAnyOf } from '@object-ui/types';
// objectui#11692 - the served -> authored conversion of a picklist-bound field.
// objectui#12027 - the parent's pending draft, unwrapped and stripped.
import { dropServedPicklistOptions, extractDraftBody } from '@object-ui/data-objectstack';

export interface EmbeddedItemEditorProps {
  parentType: string;
  parentName: string;
  /** Dotted path inside parent body where the collection lives. */
  embeddedPath?: string;
  /** Key of the item within the collection (e.g. field name). */
  itemName: string;
  /** Metadata type whose schema/form drives the form. */
  editAs?: string;
  /** Snapshot of the item at the moment of opening (initial draft). */
  initialRaw: Record<string, unknown>;
  /** Called after a successful save with the freshly-saved item. */
  onSaved?: (item: Record<string, unknown>) => void;
}

export function EmbeddedItemEditor({
  parentType,
  parentName,
  embeddedPath,
  itemName,
  editAs,
  initialRaw,
  onSaved,
}: EmbeddedItemEditorProps) {
  const locale = useMetadataLocale();
  const client = useMetadataClient();
  const { entries } = useMetadataTypes(client);
  const subEntry = editAs ? entries.find((e) => e.type === editAs) : undefined;
  // Fallback inline schemas for sub-types the framework registers without
  // a JSON-Schema (index lives in object.body but the registry only
  // exposes its metadata, not its shape). The schemas below mirror the
  // framework's Zod definitions — a claim that is now ASSERTED rather
  // than promised, by `EmbeddedItemEditor.indexFallback.test.tsx`.
  const fallback = !subEntry?.schema && editAs ? FALLBACK_SCHEMAS[editAs] : undefined;
  const schema = (subEntry?.schema as Record<string, unknown> | undefined) ?? fallback?.schema;
  const form = subEntry?.form ?? fallback?.form;
  // Opt-in per sub-type, exactly like the Preview tab on the full page: a type
  // with no registered renderer gets no surface at all (never a "preview not
  // available" placeholder). Read through the hook so a preview registered
  // after this drawer opened still mounts (objectui#11939).
  const registeredPreview = useRegisteredMetadataPreview(editAs ?? '');
  const Preview = editAs ? registeredPreview : undefined;

  const [draft, setDraft] = React.useState<Record<string, unknown>>(initialRaw);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<SchemaFormIssue[]>([]);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  // Resync if a different item is opened in the drawer.
  React.useEffect(() => {
    setDraft(initialRaw);
    setError(null);
    setIssues([]);
    setSavedAt(null);
  }, [initialRaw, itemName, parentType, parentName]);

  const readOnly =
    subEntry != null && !subEntry.allowEnvironmentOverlay && !subEntry.allowRuntimeCreate;

  async function doSave() {
    if (!embeddedPath) {
      setError(t('engine.embedded.saveNoPath', locale));
      return;
    }
    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      // 1. Re-read the parent at save time, to avoid clobbering concurrent
      // edits. objectui#12027 — its pending DRAFT is the base when one exists,
      // and the save then goes back into that draft (`mode: 'draft'`): the
      // author is mid-flight on the parent, and an item editor never writes
      // live behind their back. A served draft is the whole document
      // (objectui#10765), so every other field the draft holds rides along.
      // A draft-read failure is the save's error, never "no draft": guessing
      // there is none would send a publish-mode write over a pending one.
      const parentDraft = extractDraftBody(
        await client.getDraft(parentType, parentName),
      );
      let parent: Record<string, unknown>;
      if (parentDraft) {
        parent = parentDraft;
      } else {
        // No draft: the published version, as before. `/layers` answers 404
        // for a parent that was never published (objectstack-ai/objectstack#22397),
        // which the client resolves as every layer `null`. ⛔ That absence is
        // never a body: an empty base would PUT a stub of the one item over
        // the parent. With nothing readable, the save is refused.
        const layered = await client.layered<Record<string, unknown>>(
          parentType,
          parentName,
        );
        const published = layered.effective ?? layered.code;
        if (!published) {
          setError(
            tFormat('engine.edit.loadFailed', locale, {
              type: parentType,
              name: parentName,
              message: t('engine.form.notFound', locale),
            }),
          );
          return;
        }
        parent = published;
      }

      // 2. Splice modified item back into the parent collection.
      const updated = spliceEmbedded(parent, embeddedPath, itemName, draft);

      // 3. PUT the parent. objectui#11692 — an object parent was seeded from
      // the SERVED read above, where a picklist-bound field carries `picklist`
      // beside the options the runtime resolved from the list; the authoring
      // door refuses the pair for the whole object, whichever item was edited.
      // So the resolved `options` stay out of every bound field, and nothing
      // else is touched. Other parent types are sent exactly as before. A
      // draft-based save stays a draft; a published parent with no pending
      // draft saves as it always has.
      const body =
        parentType === 'object' ? dropServedPicklistOptions(updated) : updated;
      if (parentDraft) {
        await client.save(parentType, parentName, body, { mode: 'draft' });
      } else {
        await client.save(parentType, parentName, body);
      }
      setSavedAt(Date.now());
      onSaved?.(draft);
    } catch (err: any) {
      // Validation issues from the parent save apply to the embedded
      // path. Try to scope them back to this item.
      if (err?.status === 422 || errorCodeIsAnyOf(err, ['INVALID_METADATA', 'INVALID_PAYLOAD'])) {
        // Read off the client's parsed `MetadataError`, whose `issues` already
        // carries both live wire shapes (the REST door's top-level `issues`,
        // the HTTP dispatcher's `error.details.issues`). ⛔ Never re-read
        // `err.body.issues`: only the REST door fills it, so a dispatcher
        // refusal counted zero issues and marked no field (objectui#11379).
        const raw = err?.issues ?? [];
        const mapped: SchemaFormIssue[] = (Array.isArray(raw) ? raw : []).map((x: any) => {
          const fullPath = Array.isArray(x.path) ? x.path.join('.') : String(x.path ?? '');
          // Trim the `<embeddedPath>.<itemName>.` prefix so issues
          // align with the field they reference inside the sub-form.
          const prefix = `${embeddedPath}.${itemName}.`;
          const trimmed = fullPath.startsWith(prefix)
            ? fullPath.slice(prefix.length)
            : fullPath;
          return { path: trimmed, message: translateValidationMessage(String(x.message ?? 'Invalid'), locale) };
        });
        setIssues(mapped);
        setError(
          mapped.length === 1
            ? t('engine.validation.failedOne', locale)
            : tFormat('engine.validation.failed', locale, { count: mapped.length }),
        );
      } else {
        setError(err?.message ?? String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  // No schema registered for this sub-type: fall back to JSON editing.
  if (!schema) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-xs text-muted-foreground">
          {tFormat('engine.embedded.noSchema', locale, {
            type: editAs ?? 'this item',
            target: `${parentType}/${parentName}.${embeddedPath}.${itemName}`,
          })}
        </div>
        <textarea
          className="w-full h-[60vh] font-mono text-xs border rounded p-3 bg-muted/30"
          value={JSON.stringify(draft, null, 2)}
          onChange={(e) => {
            try {
              setDraft(JSON.parse(e.target.value));
              setError(null);
            } catch (err: any) {
              setError(`${t('engine.form.invalidJson', locale)}: ${err.message}`);
            }
          }}
        />
        {error && (
          <div className="text-sm text-destructive border border-destructive/30 rounded p-2 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 inline mr-1" /> {error}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={doSave} disabled={saving || !embeddedPath}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            {tFormat('engine.embedded.saveIntoParent', locale, { parentType: 'parent' })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {error && (
        <div className="text-sm text-destructive border border-destructive/30 rounded p-3 bg-destructive/5">
          {error}
        </div>
      )}
      {savedAt != null && !error && (
        <div className="text-sm text-emerald-700 border border-emerald-300 bg-emerald-50 rounded p-2">
          {t('engine.embedded.saved', locale)}
        </div>
      )}
      {readOnly && (
        <div className="text-xs text-amber-800 border border-amber-300 bg-amber-50 rounded p-2">
          {t('engine.embedded.readOnlyParent', locale)}
        </div>
      )}

      {Preview && (
        // Read-only: the drawer edits through the form below, so no `onPatch`
        // is handed over and `editing` stays false. `draft` is the live value,
        // so the preview follows keystrokes the way the full-page tab does.
        /* eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataPreview returns a registered component (stable), not one created during render */
        <Preview
          type={editAs as string}
          name={itemName}
          draft={draft}
          locale={locale}
          editing={false}
        />
      )}

      {/* This editor only ever renders inside `MetadataDetailDrawer`, i.e. on
          top of a page that is still rendering its own form. The scope segment
          keeps the two instances' top-level ids apart so this form's labels
          address THIS form's controls (objectui#5092). */}
      <SchemaForm
        schema={schema}
        idPath={DRAWER_EMBEDDED_ITEM_ID_SCOPE}
        form={form}
        value={draft}
        onChange={setDraft}
        issues={issues}
      />

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button onClick={doSave} disabled={saving || !embeddedPath}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          {tFormat('engine.embedded.saveIntoParent', locale, { parentType })}
        </Button>
      </div>

      {!embeddedPath && (
        <div className="text-xs text-muted-foreground border rounded p-3">
          <div className="font-medium">{t('engine.embedded.readOnly', locale)}</div>
          <div>{t('engine.embedded.noPathHint', locale)}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Return a NEW parent object with the embedded item replaced. The
 * collection at `path` may be either a name-keyed map (`object.fields`)
 * or an array of `{ name, … }` entries (`object.indexes`); we keep the
 * existing shape.
 */
function spliceEmbedded(
  parent: Record<string, unknown>,
  path: string,
  itemName: string,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const segs = path.split('.');
  const next = structuredClone(parent);
  let cur: any = next;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  const leaf = segs[segs.length - 1];
  const existing = cur[leaf];
  if (Array.isArray(existing)) {
    const idx = existing.findIndex(
      (x) => x && typeof x === 'object' && (x as any).name === itemName,
    );
    if (idx >= 0) {
      existing[idx] = item;
    } else {
      existing.push(item);
    }
  } else if (existing && typeof existing === 'object') {
    // Strip the synthetic `name` we injected when extracting the map.
    const { name: _n, ...rest } = item as { name?: unknown } & Record<string, unknown>;
    (existing as Record<string, unknown>)[itemName] = rest;
  } else {
    // Path didn't exist — initialise as a map keyed by item name.
    const { name: _n, ...rest } = item as { name?: unknown } & Record<string, unknown>;
    cur[leaf] = { [itemName]: rest };
  }
  return next;
}

/**
 * Inline JSONSchema + form-spec fallbacks for sub-types that the
 * framework's `/meta` registry doesn't expose a `schema`/`form` for.
 *
 * `index` is the only one we still need to ship here: it's an
 * embedded-only sub-type (lives inside `object.indexes[]`) and is not
 * registered as a standalone metadata type, so the server has no slot
 * to publish a schema for it. Once / if the framework grows an
 * embedded-sub-type registry, this can move server-side too.
 *
 * `validation` used to be here but is now published by the server via
 * `HAND_CRAFTED_SCHEMAS.validation` in `objectql/protocol.ts`.
 *
 * ## ⛔ This copy must MIRROR `IndexSchema`, and that is now pinned
 *
 * A hand-copied schema is a drift source by construction, and this one drifted
 * (objectstack#5247): it grew a `where` control the spec never declared and a
 * `brin` value the spec never allowed. `EmbeddedItemEditor.indexFallback.test.tsx`
 * now parses a fixture built from these very properties through the INSTALLED
 * `@objectstack/spec`, so a control that edits a key the spec drops or rejects
 * fails the build instead of shipping.
 *
 * ### Do not re-add `type` ("Algorithm") or `partial` / `where`
 *
 * Both keys were RETIRED in `@objectstack/spec` 17.0.0 (objectstack#5248,
 * ADR-0049 enforce-or-remove, maintainer ruling 2026-08-06) and are `retiredKey`
 * tombstones in `IndexSchema` today — the spec REJECTS them at any value, so the
 * old "Algorithm" select was a control every one of whose options now produces a
 * 422 on the parent save. `where` was never declared at all (the spec's spelling
 * was `partial`, itself now retired), so it was silently dropped on every save.
 *
 * The replacements are not console controls: an index METHOD is the
 * driver/dialect's choice, and a PARTIAL index is built at the database layer by
 * a runtime migration issuing `CREATE [UNIQUE] INDEX … WHERE`. Neither is a
 * declaration-surface concern, so neither comes back here.
 */
export const FALLBACK_SCHEMAS: Record<
  string,
  { schema: Record<string, unknown>; form?: FormViewSpec }
> = {
  index: {
    schema: {
      type: 'object',
      required: ['fields'],
      properties: {
        name: {
          type: 'string',
          title: 'Name',
          description: 'Index name (auto-generated from the columns if not provided).',
        },
        fields: {
          type: 'array',
          title: 'Fields',
          description: 'Fields included in the index, in order.',
          items: { type: 'string' },
        },
        // ADR-0120: `unique` is a SCOPE, not a flag —
        // `z.union([z.boolean(), z.literal('global'), z.literal('organization')])`.
        // The union is mirrored verbatim, with the scope branch FIRST on
        // purpose: `resolveUnionBranch` falls back to `branches[0]` when the
        // value is absent, so a new index gets the scope select and can only
        // author a spelling that survives protocol 18. An index already
        // carrying the legacy boolean scores the boolean branch and keeps
        // rendering as the switch it was authored with, unchanged.
        //
        // Bare `true` is the DEPRECATED positional spelling of `'global'`: lint
        // `unique/unscoped-declared-index` warns on it in 17.x and protocol 18
        // rejects it (objectstack#5082), which is why it is not offered as an
        // option here. Leaving the control empty is the spec default (`false`).
        unique: {
          title: 'Unique',
          description:
            "Whether the index enforces uniqueness, and at which scope. 'global' " +
            'materializes over exactly the listed fields — one holder across the whole ' +
            "installation. 'organization' has the driver prepend the NULL-safe " +
            'organization key part at registration — one holder per organization. Leave ' +
            'empty for a non-unique index.',
          anyOf: [
            { type: 'string', enum: ['global', 'organization'] },
            { type: 'boolean' },
          ],
        },
      },
    },
  },
};
