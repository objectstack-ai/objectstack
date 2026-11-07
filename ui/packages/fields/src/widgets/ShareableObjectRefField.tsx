/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Combobox, cn } from '@object-ui/components';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';
import type { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';
import { objectRefOptionLabel } from './objectRefLabel.js';
import { ObjectRefField } from './ObjectRefField.js';

/**
 * ShareableObjectRefField — the `shareable-object-ref` widget: the object
 * picker of a sharing rule, offering only the objects a rule can take effect on
 * (`sys_sharing_rule.object_name`).
 *
 * The list is the server's, read from the sharing plugin's shareable-objects
 * door through the host's authenticated fetch (`SchemaRendererContext.apiFetch`).
 * The door lists exactly the objects a rule save admits (it asks the save
 * doors' own `SHARING_NOT_ENABLED` verdict), business objects first, then
 * platform objects, each by label. The picker shows that order as given and
 * never re-sorts it.
 *
 * When the door does not answer the list, the field is the `object-ref`
 * picker, unchanged: every registered object, as before this widget existed.
 * That covers a caller the door refuses (`403`: the list is the sharing-rule
 * administrators'), a deployment where sharing rules do not run (`501`), a
 * server without the door, an answer that is not the door's shape, and a host
 * with no authenticated fetch. The save doors stay the authority on which
 * object a rule may name, so the wider list costs a refusal at save, never a
 * wrong rule; an empty picker would leave the field unfillable.
 *
 * The stored value is always the object's machine name. A stored name the list
 * does not hold (a rule on an object that no longer takes one) stays on screen
 * as its own option, so editing the rule never drops it. The read-only face is
 * `object-ref`'s, which labels the stored name without asking the door.
 */

/** The door the list is read from (plugin-sharing `shareable-objects-routes.ts`). */
export const SHAREABLE_OBJECTS_URL = '/api/v1/sharing/shareable-objects';

/** One listed object, as the door answers it. */
interface ShareableObjectHeader {
  name: string;
  label: string;
}

type ShareableCatalog =
  | { status: 'loading' }
  | { status: 'listed'; objects: ShareableObjectHeader[] }
  | { status: 'fallback' };

const LOADING: ShareableCatalog = { status: 'loading' };
const FALLBACK: ShareableCatalog = { status: 'fallback' };

/** The door's list, or `null` when the answer is not the door's success shape. */
function listOf(body: unknown): ShareableObjectHeader[] | null {
  const raw = (body as { data?: { objects?: unknown } } | null)?.data?.objects;
  if (!Array.isArray(raw)) return null;
  const objects: ShareableObjectHeader[] = [];
  for (const entry of raw) {
    const name = (entry as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || name === '') continue;
    const label = (entry as { label?: unknown }).label;
    objects.push({ name, label: typeof label === 'string' ? label : '' });
  }
  return objects;
}

async function readShareableObjects(doFetch: ApiFetch): Promise<ShareableObjectHeader[] | null> {
  const res = await doFetch(SHAREABLE_OBJECTS_URL, {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) return null;
  return listOf(await res.json());
}

function useShareableObjects(doFetch: ApiFetch | undefined, enabled: boolean): ShareableCatalog {
  const [catalog, setCatalog] = React.useState<ShareableCatalog>(doFetch && enabled ? LOADING : FALLBACK);
  React.useEffect(() => {
    if (!doFetch || !enabled) {
      setCatalog(FALLBACK);
      return;
    }
    let cancelled = false;
    setCatalog(LOADING);
    readShareableObjects(doFetch).then(
      (objects) => {
        if (!cancelled) setCatalog(objects ? { status: 'listed', objects } : FALLBACK);
      },
      () => {
        if (!cancelled) setCatalog(FALLBACK);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doFetch, enabled]);
  return catalog;
}

export function ShareableObjectRefField(props: FieldWidgetComponentProps<string>) {
  const { value, onChange, readonly, className, error, ...rest } = props;
  const ctx = React.useContext(SchemaRendererContext);
  const { t } = useFieldTranslation();
  const catalog = useShareableObjects(ctx?.apiFetch, !readonly);

  const options = React.useMemo(() => {
    if (catalog.status !== 'listed') return [];
    const opts = catalog.objects.map((o) => ({ value: o.name, label: objectRefOptionLabel(o.name, o.label) }));
    if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value });
    return opts;
  }, [catalog, value]);

  if (readonly || catalog.status === 'fallback') return <ObjectRefField {...props} />;

  // DOM pass-through onto the combobox trigger, as `object-ref` does: `name`
  // is withheld because the trigger is a button, not a submission control.
  const { name: _domName, ...triggerDomProps } = toDomProps(rest);
  const loading = catalog.status === 'loading';

  return (
    <Combobox
      {...triggerDomProps}
      options={options}
      value={value ?? ''}
      onValueChange={(v) => onChange(v)}
      placeholder={loading ? t('fields.objectRef.loading') : t('fields.objectRef.placeholder')}
      searchPlaceholder={t('fields.objectRef.search')}
      emptyText={loading ? t('common.loading') : t('fields.objectRef.empty')}
      disabled={rest.disabled}
      className={cn('w-full', className)}
      aria-invalid={!!error}
    />
  );
}

export default ShareableObjectRefField;
