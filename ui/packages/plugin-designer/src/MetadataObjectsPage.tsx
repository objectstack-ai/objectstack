/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MetadataObjectsPage
 *
 * Setup-app container that lists every object schema known to the
 * ObjectStack server (via `GET /api/v1/meta/object`) and renders it in
 * the visual {@link ObjectManager}. Reads, edits, creates and deletes
 * persist through the metadata REST API
 * (`PUT/DELETE /api/v1/meta/object/:name`) using
 * {@link MetadataClient}.
 *
 * Architectural note — Salesforce-style Setup vs ad-hoc dialogs:
 *   - Object metadata is treated as a first-class resource, not as a
 *     side effect of running migrations. The page is host-app routable
 *     (mount it at e.g. `/apps/setup/_meta/object`) and serves as the
 *     single visual entry point that mirrors the underlying protocol
 *     contract in `packages/spec/src/data/object.zod.ts`.
 *   - The framework gates creation/deletion via the metadata type
 *     registry (`DEFAULT_METADATA_TYPE_REGISTRY` -> `object` currently
 *     has `allowRuntimeCreate: false`). When the server rejects a write
 *     we surface the 4xx error rather than silently swallowing it, so
 *     admins discover the constraint explicitly.
 *
 * The container deliberately keeps {@link ObjectManager} unchanged —
 * `ObjectManager` is a pure controlled component and continues to be
 * usable in design-time / preview contexts with in-memory data.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ObjectDefinition } from '@object-ui/types';
import { MetadataClient, dropServedPicklistOptions, type MetadataClientConfig } from '@object-ui/data-objectstack';
import { ObjectManager } from './ObjectManager';

/**
 * Minimal shape we consume from a framework ObjectSchema payload — and, merged
 * back in {@link MetadataObjectsPage}, the body of `PUT /api/v1/meta/object/:name`.
 */
interface ServerObjectSchema {
  name: string;
  label?: string;
  pluralLabel?: string;
  description?: string;
  icon?: string;
  // No `group` (objectui#6223): `ObjectSchema` has no object-level grouping key
  // and refuses this one BY NAME, so the merged save-back made the whole PUT a
  // 422 `INVALID_METADATA` — which then blocks EVERY later save of that object.
  // Nothing is lost by dropping it: a key the schema refuses was never stored,
  // so `raw.group` was always absent on the way back in. The manager's grouping
  // is a display category and `toObjectDefinition` derives it below.
  isSystem?: boolean;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MetadataObjectsPageProps {
  /**
   * Either a pre-built {@link MetadataClient} or the config to build
   * one. Passing a client lets the host share an auth-decorated
   * instance across pages.
   */
  client?: MetadataClient;
  /** Used when `client` is omitted. */
  clientConfig?: MetadataClientConfig;
  /** Hide objects with `isSystem: true`. Defaults to false (show all). */
  hideSystemObjects?: boolean;
  /** Read-only mode (disables Create / Edit / Delete in the manager). */
  readOnly?: boolean;
  /**
   * Notified when the user opens an object for field editing. Host apps
   * typically use this to navigate to a sibling fields page
   * (e.g. `/apps/setup/_meta/object/:name/fields`).
   */
  onSelectObject?: (object: ObjectDefinition, raw: ServerObjectSchema) => void;
  /** Optional CSS class for the wrapper. */
  className?: string;
}

function toObjectDefinition(raw: ServerObjectSchema): ObjectDefinition {
  const fieldCount = raw.fields && typeof raw.fields === 'object'
    ? Object.keys(raw.fields as Record<string, unknown>).length
    : 0;
  return {
    // ObjectDefinition.id is for the local Manager's row identity; using
    // the object name keeps it stable across reloads.
    id: raw.name,
    name: raw.name,
    label: raw.label ?? raw.name,
    pluralLabel: raw.pluralLabel,
    description: raw.description,
    icon: raw.icon,
    // Derived, never round-tripped (objectui#6223). `group` is the Object
    // Manager's display category; `ObjectSchema` has no object-level grouping
    // key, so the server neither stores nor serves one. Deriving it from the
    // spec key that IS accepted (`isSystem`) keeps the grouping control
    // populated with the same two `OBJECT_GROUPS` entries the sibling
    // converter uses, instead of reading a key that can only ever be absent.
    group: (raw.isSystem ?? false) ? 'System Objects' : 'Custom Objects',
    isSystem: raw.isSystem ?? false,
    fieldCount,
  };
}

/**
 * The value the server stamps as `_packageId` on a row bound to NO package. It
 * names no package, so it is never sent as one.
 */
const PACKAGELESS_SENTINEL = 'sys_metadata';

/**
 * The package a listed object is served from (its served `_packageId`), or
 * `undefined` for an object no package owns (objectui#12335).
 *
 * The same reading the metadata list uses to put `?package=` on an item's edit
 * link, which the editor then states on its save, publish and reset: one
 * served value, one meaning across the console.
 */
function owningPackage(raw: ServerObjectSchema | undefined): string | undefined {
  const packageId = raw?._packageId;
  return typeof packageId === 'string' && packageId !== '' && packageId !== PACKAGELESS_SENTINEL
    ? packageId
    : undefined;
}

interface ServerObjectsState {
  loading: boolean;
  error: string | null;
  /**
   * Raw server payloads, indexed by object name (for save-back merging).
   *
   * A `Map`, not a plain object (objectui#6522). Object names are server data:
   * `ObjectSchema` pins them to /^[a-z_][a-z0-9_]*$/, which accepts BOTH
   * `constructor` and `__proto__`. Filled by assignment into an object
   * literal, the `__proto__` entry invoked the prototype setter instead of
   * creating a key — the object never became an own property, so it never
   * reached the manager at all and left its payload on the lookup's prototype
   * chain for every later name to answer out of. A `Map` key is just a key.
   *
   * Nothing serialises this container — only its VALUES are spread into a PUT
   * body — so unlike the fields map in the sibling `MetadataFieldsPage` it has
   * no reason to stay a plain object. Same ruling (objectui#6489 /
   * objectui#6240), the shape that fits this lookup.
   */
  byName: Map<string, ServerObjectSchema>;
}

export function MetadataObjectsPage({
  client: clientProp,
  clientConfig,
  hideSystemObjects = false,
  readOnly = false,
  onSelectObject,
  className,
}: MetadataObjectsPageProps) {
  const client = useMemo(() => {
    if (clientProp) return clientProp;
    if (!clientConfig) {
      throw new Error('MetadataObjectsPage: provide either `client` or `clientConfig`.');
    }
    return new MetadataClient(clientConfig);
  }, [clientProp, clientConfig]);

  const [state, setState] = useState<ServerObjectsState>({
    loading: true,
    error: null,
    byName: new Map(),
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const items = await client.list<ServerObjectSchema>('object');
      const byName = new Map<string, ServerObjectSchema>();
      for (const item of items) {
        if (item && typeof item === 'object' && typeof item.name === 'string') {
          byName.set(item.name, item);
        }
      }
      setState({ loading: false, error: null, byName });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        byName: new Map(),
      });
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const objects = useMemo<ObjectDefinition[]>(
    () => [...state.byName.values()].map(toObjectDefinition),
    [state.byName],
  );

  /**
   * Diff the previous controlled list against the new one emitted by
   * ObjectManager and translate each change into the appropriate REST
   * call. ObjectManager batches add/update/delete into a single
   * onObjectsChange invocation, so we treat the diff as the source of
   * truth.
   *
   * Deletes are issued via DELETE /meta/object/:name (overlay reset).
   * Updates merge the manager's edited fields back onto the raw server
   * payload to preserve everything the manager doesn't render (fields,
   * indexes, hooks, permissions, etc.).
   */
  const handleObjectsChange = useCallback(async (next: ObjectDefinition[]) => {
    const prev = state.byName;
    // objectui#6522 — a `Map`, because the READ below is the consequential
    // half. Built by assignment into an object literal, `!nextByName[name]`
    // answered out of `Object.prototype`: for an object named `constructor`
    // the lookup returned the `Object` function, the deletion read as "still
    // present", and `client.reset` never fired. No error, no refusal — the row
    // vanished from the manager, the save reported success, and the object was
    // still there after the reload. `Map.has` consults nothing but the entries
    // actually put in. Never serialised: built, read and discarded right here.
    const nextByName = new Map<string, ObjectDefinition>(next.map((o) => [o.name, o]));

    const errors: string[] = [];

    // Deletions
    for (const name of prev.keys()) {
      if (!nextByName.has(name)) {
        try {
          // objectui#12335 — name the package of the row this page lists, so a
          // name two packages hold is not refused `409 RESOURCE_CONFLICT`. A
          // row no package owns sends none, and a refusal lands in `errors`.
          const packageId = owningPackage(prev.get(name));
          await client.reset('object', name, packageId ? { packageId } : {});
        } catch (err) {
          errors.push(`Delete ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Inserts + updates
    for (const updated of next) {
      // One own-entry lookup feeding both the merge base and the
      // redundant-save guard below (objectui#6522). Off a plain object literal
      // a name that was never stored still answered — `prev['constructor']`
      // handed back the `Object` function — so the merge spread the wrong base
      // and the guard below compared against inherited `undefined`s.
      const previous = prev.get(updated.name);
      const base = previous ?? { name: updated.name };
      const merged: ServerObjectSchema = {
        ...base,
        name: updated.name,
        label: updated.label,
        pluralLabel: updated.pluralLabel,
        description: updated.description,
        icon: updated.icon,
        // `group` is deliberately not merged back (objectui#6223) — see the
        // note on `ServerObjectSchema`.
        isSystem: updated.isSystem,
      };
      // `...base` is a verbatim spread of whatever the server sent, so simply
      // not writing `group` is not enough: an object that already has the key
      // stored from before this fix would spread it straight back out and stay
      // permanently unsaveable. Strip it on the way out too — the objectui#4644
      // strip-on-load shape, applied on the write side where the spread is.
      delete merged.group;
      // Don't issue redundant saves if nothing visible changed.
      if (
        previous
        && previous.label === merged.label
        && previous.pluralLabel === merged.pluralLabel
        && previous.description === merged.description
        && previous.icon === merged.icon
      ) {
        continue;
      }
      try {
        // objectui#11692 — `merged` spreads the SERVED object (`client.list`),
        // whose picklist-bound fields carry `picklist` beside the options the
        // runtime resolved from the list. The authoring door refuses the pair
        // for the whole object, so a relabel here was refused for a field it
        // never touched. The resolved `options` stay out of the body.
        await client.save('object', updated.name, dropServedPicklistOptions(merged));
      } catch (err) {
        errors.push(`Save ${updated.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await reload();
    if (errors.length > 0) {
      setState((s) => ({ ...s, error: errors.join('\n') }));
    }
  }, [client, reload, state.byName]);

  const handleSelectObject = useCallback((obj: ObjectDefinition) => {
    const raw = state.byName.get(obj.name);
    if (raw && onSelectObject) onSelectObject(obj, raw);
  }, [onSelectObject, state.byName]);

  if (state.loading) {
    return (
      <div className={className} data-testid="metadata-objects-page-loading">
        Loading objects…
      </div>
    );
  }

  return (
    <div className={className} data-testid="metadata-objects-page">
      {state.error && (
        <pre
          data-testid="metadata-objects-page-error"
          className="mb-2 whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700"
        >
          {state.error}
        </pre>
      )}
      <ObjectManager
        objects={objects}
        onObjectsChange={(next) => { void handleObjectsChange(next); }}
        onSelectObject={onSelectObject ? handleSelectObject : undefined}
        showSystemObjects={!hideSystemObjects}
        readOnly={readOnly}
      />
    </div>
  );
}

export default MetadataObjectsPage;
