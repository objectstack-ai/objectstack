// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * External (federated) objects in the object designer — ADR-0015.
 *
 * An object is external exactly when it carries an `external` binding
 * (`ObjectExternalBindingSchema`, `@objectstack/spec/data`). That is the same
 * presence test the runtime uses to decide that an object is never a DDL
 * target (`isFederatedObject` in `@objectstack/objectql`): its table belongs
 * to the remote database. The designer therefore offers no control that would
 * change the remote table's shape — add, duplicate, delete, rename or retype a
 * field — and says where the fields come from instead.
 *
 * Writes to an external object need BOTH opt-ins: the datasource's
 * `external.allowWrites` and the object's own `external.writable` (ADR-0015
 * §5.3, the engine's write gate). The object alone settles the common case:
 * without `writable: true` it is read-only whatever the datasource says. Only
 * when the object opts in is the datasource read, through the same metadata
 * door the datasource preview reads `external.allowWrites` from; until that
 * answer arrives, or when it cannot be read, the state is shown as
 * unconfirmed rather than guessed.
 */

import * as React from 'react';
import { Badge } from '@object-ui/components';
import { DatabaseZap } from 'lucide-react';
import { useMetadataClient } from '../useMetadata.js';
import { t, tFormat } from '../i18n.js';

export interface ExternalObjectBinding {
  /** The object's `datasource` — the federated datasource its table lives in. */
  datasource: string;
  /** The object's own write opt-in, `external.writable`. */
  writable: boolean;
}

/** `read-only` and `writable` are settled; `unconfirmed` means the datasource half is not known. */
export type ExternalWriteState = 'read-only' | 'writable' | 'unconfirmed';

/** The object draft's external binding, or `null` for an object the platform owns. */
export function readExternalBinding(
  draft: Record<string, unknown> | null | undefined,
): ExternalObjectBinding | null {
  const external = draft?.external;
  if (external == null) return null;
  return {
    // `ObjectSchema.datasource` defaults to `'default'`; an `external` binding
    // on it is refused at authoring, which is the producer's door, not this one.
    datasource: typeof draft?.datasource === 'string' ? draft.datasource : 'default',
    writable: typeof external === 'object' && (external as { writable?: unknown }).writable === true,
  };
}

/**
 * The binding's write state. Reads the datasource only when the object itself
 * opts in to writes; keyed on the datasource NAME, never on the client's
 * identity (ui/AGENTS.md #10).
 */
export function useExternalWriteState(binding: ExternalObjectBinding | null): ExternalWriteState | null {
  const client = useMetadataClient();
  const clientRef = React.useRef(client);
  clientRef.current = client;
  const datasource = binding?.writable ? binding.datasource : null;
  const [answer, setAnswer] = React.useState<{ datasource: string; allows: boolean | null } | null>(null);

  React.useEffect(() => {
    if (!datasource) return;
    let live = true;
    clientRef.current.get<Record<string, unknown>>('datasource', datasource).then(
      (item) => {
        if (!live) return;
        const external = item?.external as { allowWrites?: unknown } | undefined;
        setAnswer({ datasource, allows: item ? external?.allowWrites === true : null });
      },
      () => {
        if (live) setAnswer({ datasource, allows: null });
      },
    );
    return () => {
      live = false;
    };
  }, [datasource]);

  if (!binding) return null;
  if (!binding.writable) return 'read-only';
  if (!answer || answer.datasource !== binding.datasource || answer.allows === null) return 'unconfirmed';
  return answer.allows ? 'writable' : 'read-only';
}

/** "From plan_gantt · Read-only" — the per-field source and write-state mark. */
export function ExternalFieldBadge({
  binding,
  state,
  locale,
}: {
  binding: ExternalObjectBinding;
  state: ExternalWriteState | null;
  locale?: string;
}) {
  const from = tFormat('designer.external.from', locale, { datasource: binding.datasource });
  const stateLabel =
    state === 'read-only'
      ? t('designer.external.readOnly', locale)
      : state === 'writable'
        ? t('designer.external.writable', locale)
        : t('designer.external.unconfirmed', locale);
  return (
    <Badge
      variant="outline"
      data-testid="external-field-badge"
      data-write-state={state ?? undefined}
      className="text-[10px] font-medium border-sky-500/40 text-sky-700 dark:text-sky-300"
      title={
        state === 'unconfirmed'
          ? tFormat('designer.external.unconfirmedHint', locale, { datasource: binding.datasource })
          : undefined
      }
    >
      {`${from} · ${stateLabel}`}
    </Badge>
  );
}

/** The canvas header note: where the fields come from, and why they cannot be reshaped here. */
export function ExternalObjectNotice({
  binding,
  state,
  locale,
}: {
  binding: ExternalObjectBinding;
  state: ExternalWriteState | null;
  locale?: string;
}) {
  return (
    <div
      role="note"
      data-testid="external-object-notice"
      className="flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground"
    >
      <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <ExternalFieldBadge binding={binding} state={state} locale={locale} />
        <p>{tFormat('designer.external.notice', locale, { datasource: binding.datasource })}</p>
      </div>
    </div>
  );
}
