/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@object-ui/components';
import { getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { AUDIT_FIELD_BY_ROLE } from '@object-ui/types';
import type { FieldMetadata } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
import { useDetailTranslation } from './useDetailTranslation';
import { hasCellValue } from './emptiness';

/**
 * Audit field names auto-injected by the framework's `applySystemFields` —
 * the shared vocabulary `RecordDetailView` also uses to keep these out of the
 * body sections (single source in `@object-ui/types`, objectui#3017).
 */
const AUDIT_FIELDS = AUDIT_FIELD_BY_ROLE;

export interface RecordMetaFooterProps {
  /** The current record data; expected to contain audit fields when available. */
  data: Record<string, any> | null | undefined;
  /** Resolved object schema (used to read `reference` for created_by/updated_by). */
  objectSchema?: any;
  /** Object name for future i18n hooks (currently unused). */
  objectName?: string;
  className?: string;
}

interface TFn {
  (key: string, options?: Record<string, unknown>): string;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * The actor a `created_by` / `updated_by` column names, or `undefined` when the
 * record names none.
 *
 * ⚠️ Normalized HERE, at the read, and not inside `UserRef` — this is the one
 * site on the record page where converging the emptiness predicate at the
 * renderer would have been the wrong fix (objectui#8394). FOUR consumers below
 * ask "is there an actor?" about the same value: `hasCreated` / `hasUpdated`,
 * the `sameUser` comparison that suppresses a redundant "Updated" segment, the
 * `label` choice between `detail.createdBy` and the "by"-less `detail.created`,
 * and `MetaEntry`'s own `{user ? … }` gate — and only that last one ever
 * reaches `UserRef`. So a whitespace-only `created_by` fixed at the renderer
 * alone would still pick the "Created by" label and still draw the `·`
 * separator, rendering "Created by · 5m ago" with nothing in between: exactly
 * the dangling phrase the label branch exists to prevent, just with the blank
 * moved. Answered once, all four agree.
 *
 * Emptiness is the record page's ONE definition (`./emptiness`), so an EXPANDED
 * reference payload (`{ id, name }`) stays an actor — `UserRef` hands objects
 * to `LookupCellRenderer`, which resolves them through its own display chain.
 * The card guessed this site might want the TITLE predicate instead; it does
 * not, and that is why: a bare `{ id }` payload has no display name, yet the
 * renderer still draws it.
 */
function actorOrNone<T>(value: T): T | undefined {
  return hasCellValue(value) ? value : undefined;
}

function formatRelativeTime(date: Date, t: TFn): string {
  const ms = Date.now() - date.getTime();
  // Future timestamps (clock skew, scheduled records) — fall through to "just now".
  const elapsed = Math.max(0, Math.floor(ms / 1000));
  if (elapsed < 60) return t('detail.justNow');
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return t('detail.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('detail.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('detail.daysAgo', { count: days });
}

function formatAbsolute(date: Date, locale: string): string {
  try {
    // The tag is DECLARED (objectui#9786). A literal `undefined` here is the
    // one thing `useDisplayLocale`'s own doc comment tells a caller not to do:
    // it means the MACHINE's locale, which is neither the tenant's regional
    // default nor the active UI language.
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

interface UserRefProps {
  value: unknown;
  objectSchema?: any;
  fieldName: string;
}

/**
 * Renders a created_by/updated_by value using the same cell renderer pipeline
 * as DetailSection so reference resolution (ID → display name) is consistent.
 */
const UserRef: React.FC<UserRefProps> = ({ value, objectSchema, fieldName }) => {
  // Defensive floor only: `RecordMetaFooter` already normalizes through
  // `actorOrNone`, so this agrees with the caller rather than deciding alone.
  if (!hasCellValue(value)) return null;
  const fieldDef = objectSchema?.fields?.[fieldName];
  // created_by / updated_by are ALWAYS user references on ObjectStack, but many
  // fetched schemas omit the audit system fields from `fields`. Without a
  // fallback the field degrades to `type: 'text'` and the footer prints the raw
  // user id (objectui#2688) — so default the reference target to `sys_user`.
  // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
  // belongs on the SERVER, the front end just executes the protocol.
  // `reference` is the only target spelling `@objectstack/spec`'s
  // `FieldSchema` declares; it refuses `reference_to` by name with its own
  // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
  // stored `reference_to` on the serve path and in `os migrate meta`. A
  // legacy-only def is canonicalised ONCE at the ingestion choke point
  // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
  const refTarget = fieldDef?.reference || 'sys_user';
  const enrichedField: Record<string, any> = {
    name: fieldName,
    type: fieldDef?.type || 'lookup',
    reference: refTarget,
    ...(fieldDef?.reference_field && { reference_field: fieldDef.reference_field }),
  };
  const resolvedType = resolveCellRendererType(enrichedField as { type?: string }) || enrichedField.type;
  if (resolvedType) {
    const cellRenderer = getCellRenderer(resolvedType);
    if (cellRenderer) {
      // createElement over a JSX tag: the registry returns a STABLE component
      // reference, but a locally-assigned capitalized tag reads as "component
      // created during render" to the hooks lint (state would reset if it
      // were). Direct invocation makes the stable-reference intent explicit.
      return (
        <span className="inline-flex items-center [&_a]:text-inherit [&_a]:hover:underline">
          {React.createElement(cellRenderer, {
            value,
            field: enrichedField as unknown as FieldMetadata,
          })}
        </span>
      );
    }
  }
  return <span>{String(value)}</span>;
};

interface MetaEntryProps {
  label: string;
  user?: unknown;
  date?: Date | null;
  objectSchema?: any;
  userField: string;
  t: TFn;
  /** BCP-47 tag for the absolute date in the tooltip (objectui#9786). */
  locale: string;
}

const MetaEntry: React.FC<MetaEntryProps> = ({ label, user, date, objectSchema, userField, t, locale }) => {
  if (!user && !date) return null;
  const dateNode = date ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time
            dateTime={date.toISOString()}
            className="cursor-default underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
          >
            {formatRelativeTime(date, t)}
          </time>
        </TooltipTrigger>
        <TooltipContent side="top">{formatAbsolute(date, locale)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground/70">{label}</span>
      {user ? <UserRef value={user} objectSchema={objectSchema} fieldName={userField} /> : null}
      {user && dateNode ? <span className="text-muted-foreground/40">·</span> : null}
      {dateNode}
    </span>
  );
};

/**
 * RecordMetaFooter — minimal one-line provenance footer for a record.
 *
 * Replaces the old card-style "System Information" section. Shows
 * `created_by` / `updated_by` (via the reference cell renderer so user IDs
 * resolve to names) plus relative timestamps, with absolute dates on hover.
 *
 * Renders nothing when no audit fields are present. The "Updated" segment
 * is suppressed when the record has never been updated (updated_at equals
 * created_at) to avoid redundant noise.
 */
export const RecordMetaFooter: React.FC<RecordMetaFooterProps> = ({
  data,
  objectSchema,
  objectName: _objectName,
  className,
}) => {
  const { t } = useDetailTranslation();
  // The BCP-47 tag the hover tooltip's absolute date formats with
  // (objectui#9786). Read before the early return so hook order never varies.
  const displayLocale = useDisplayLocale();
  if (!data) return null;

  const createdAt = toDate(data[AUDIT_FIELDS.createdAt]);
  const updatedAt = toDate(data[AUDIT_FIELDS.updatedAt]);
  const createdBy = actorOrNone(data[AUDIT_FIELDS.createdBy]);
  const updatedBy = actorOrNone(data[AUDIT_FIELDS.updatedBy]);

  const hasCreated = !!(createdAt || createdBy);
  // Treat updated_at within ~2s of created_at as "never touched" — covers
  // server-side timestamp jitter where create/update fire in the same tx.
  const updateIsSameAsCreate =
    createdAt && updatedAt && Math.abs(updatedAt.getTime() - createdAt.getTime()) < 2000;
  const sameUser =
    createdBy != null && updatedBy != null && String(createdBy) === String(updatedBy);
  const hasUpdated =
    !!(updatedAt || updatedBy) && !(updateIsSameAsCreate && (sameUser || !updatedBy));

  if (!hasCreated && !hasUpdated) return null;

  return (
    <div
      className={cn(
        'mt-6 pt-3 border-t border-border/40',
        'flex flex-wrap items-center gap-x-4 gap-y-1',
        'text-xs text-muted-foreground',
        className,
      )}
      data-testid="record-meta-footer"
    >
      {hasCreated && (
        <MetaEntry
          // No actor (system/seeded rows) → the "by"-less label; "Created
          // by · 5m ago" read as a dangling phrase.
          label={createdBy ? t('detail.createdBy') : t('detail.created')}
          user={createdBy}
          date={createdAt}
          objectSchema={objectSchema}
          userField={AUDIT_FIELDS.createdBy}
          t={t}
          locale={displayLocale}
        />
      )}
      {hasUpdated && (
        <MetaEntry
          label={updatedBy ? t('detail.updatedBy') : t('detail.updated')}
          user={updatedBy}
          date={updatedAt}
          objectSchema={objectSchema}
          userField={AUDIT_FIELDS.updatedBy}
          t={t}
          locale={displayLocale}
        />
      )}
    </div>
  );
};
