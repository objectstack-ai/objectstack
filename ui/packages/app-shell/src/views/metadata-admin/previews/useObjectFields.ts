// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useObjectFields — loads an Object's field catalog for the View column
 * configurator's "Available fields" pane.
 *
 * Reads `object.fields` (record OR array shape) via the shared
 * MetadataClient and normalizes it into a flat, ordered list the picker
 * can render. Hidden fields are kept (admins legitimately surface them)
 * but flagged so the picker can de-emphasize them.
 *
 * The hook is defensive: a missing object name, a 404, or a transport
 * error all resolve to an empty list with `error` set, so the configurator
 * can gracefully fall back to manual column entry.
 *
 * It reads the draft-overlaid object (`?preview=draft`, objectui#11895), so a
 * pending draft's fields are offered before the object's first publish and a
 * published object with no draft reads as it always did.
 */

import * as React from 'react';
import { useMetadataClient } from '../useMetadata.js';
import { t, useMetadataLocale } from '../i18n.js';
import { readFields } from './object-fields-io.js';

export interface ObjectFieldInfo {
  /** snake_case API name. */
  name: string;
  /** Human label (falls back to the name). */
  label: string;
  /** Raw field type id (e.g. 'text', 'lookup'). */
  type: string;
  hidden: boolean;
  /**
   * `true` when the served definition marks the field `system` — a column the
   * platform injects. Absent otherwise.
   *
   * Carried so a Studio field picker can tell the platform's own bookkeeping
   * columns (`system` AND `hidden` together: the `__search` companion,
   * `owning_business_unit_id`, `organization_id`) from an author's own hidden
   * field, with the one predicate the Data rail uses
   * (`isStudioHiddenSystemField`, objectui#11780). The list-view inspector's
   * field pickers and the flow reference picker's `object-field` suggestions
   * drop such a field (objectui#13152). Like `required` below, it is the same
   * served payload read once more; this hook still returns every field, and a
   * caller that does not read the flag sees the list it always did.
   */
  system?: boolean;
  /**
   * `true` when the object declares the field `required` — the write-time
   * contract the server enforces on every save. Absent otherwise.
   *
   * Carried for the view inspector's refusal of a required field placed in a
   * predicate-gated form section (objectui#6900): the served object document
   * already holds the flag, so this is the same payload read once more, not a
   * second data path. Hosts that pass an override catalog and leave it out get
   * no such refusal.
   */
  required?: boolean;
}

export interface UseObjectFieldsResult {
  fields: ObjectFieldInfo[];
  loading: boolean;
  error: string | null;
}

export function useObjectFields(
  objectName: string | undefined,
  /**
   * Pre-resolved field catalog. When supplied the hook skips the network
   * fetch entirely and returns this list verbatim — used by hosts that
   * already hold the object definition (e.g. the runtime ViewConfigPanel,
   * which reads `objectDef.fields`) so the inspector has zero network
   * dependency.
   */
  override?: ObjectFieldInfo[],
): UseObjectFieldsResult {
  const client = useMetadataClient();
  // The designer locale the hook's own not-found sentence reads in
  // (objectui#10862). The fetch records THAT the object was not found, and the
  // row is read here, where the hook returns, so a language switch re-reads it
  // without a refetch. A transport error is the transport's message and
  // passes through as it came.
  const locale = useMetadataLocale();
  const [state, setState] = React.useState<{ result: UseObjectFieldsResult; notFound: boolean }>({
    result: {
      fields: [],
      loading: !override && !!objectName,
      error: null,
    },
    notFound: false,
  });

  React.useEffect(() => {
    // Override short-circuits the fetch: trust the caller-supplied catalog.
    if (override) {
      setState({ result: { fields: override, loading: false, error: null }, notFound: false });
      return;
    }
    if (!objectName) {
      setState({ result: { fields: [], loading: false, error: null }, notFound: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ result: { ...s.result, loading: true, error: null }, notFound: false }));
    // objectui#11895 — read the DRAFT-OVERLAID object (`?preview=draft`), the
    // read objectui#11783's object picker already makes for the list. Every
    // caller that reaches this fetch is an authoring surface (Studio and the
    // metadata-admin designers; the runtime `ViewConfigPanel` passes
    // `override` and stops above), and an author builds automations, views
    // and pages before the object's first publish. The published read answers
    // 404 for a draft-only object, so every field picker reading this hook
    // offered no fields for it — the flow entry-condition builder only
    // `previous`.
    //
    // One request answers both cases, so there is no second, published read:
    // the framework's `getMetaItem({ previewDrafts: true })` serves the
    // pending draft when there is one and falls back to the active object
    // otherwise (never `no_draft`), and a caller the server does not admit to
    // drafts is answered the published object as if it had not asked. A 404
    // here therefore means neither a draft nor a published object exists.
    //
    // Derived here rather than memoised: the effect keys on `client`
    // (AGENTS.md #10), and the derived client shares `client`'s transport, so
    // a read already in flight for the same URL is still shared
    // (objectui#11797).
    client
      .withPreviewDrafts(true)
      .get<Record<string, unknown>>('object', objectName)
      .then((obj) => {
        if (cancelled) return;
        if (!obj) {
          setState({ result: { fields: [], loading: false, error: null }, notFound: true });
          return;
        }
        const view = readFields((obj as any).fields);
        const fields: ObjectFieldInfo[] = view.entries.map((e) => ({
          name: e.name,
          label:
            typeof e.def.label === 'string' && e.def.label
              ? (e.def.label as string)
              : e.name,
          type: typeof e.def.type === 'string' ? (e.def.type as string) : 'text',
          hidden: e.def.hidden === true,
          ...(e.def.system === true ? { system: true } : {}),
          ...(e.def.required === true ? { required: true } : {}),
        }));
        setState({ result: { fields, loading: false, error: null }, notFound: false });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          result: {
            fields: [],
            loading: false,
            error: err?.message ?? String(err),
          },
          notFound: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, objectName, override]);

  return state.notFound ? { ...state.result, error: t('engine.form.objectNotFound', locale) } : state.result;
}
