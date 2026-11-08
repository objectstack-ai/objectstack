// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One person's effective permission sets, each with every way it reaches them
 * — the SDUI widget `security:effective-access`, for a `sys_user` record page.
 *
 * The page's Permission Sets tab otherwise lists only the person's stored
 * `sys_user_permission_set` rows, so someone who holds access through the
 * default binding or a position reads as having none. This widget draws the
 * server's answer instead: `security.describeEffectiveAccess(userId)` of
 * `@objectstack/client`, resolved by the resolver enforcement uses. It
 * computes nothing of its own: every set and every origin is the answer's.
 *
 * It reads one thing from the page: the bound record (`useRecordContext()`),
 * which must be a `sys_user` record with an id. Of the node it reads only
 * `className`; it takes no props, so its `@object-ui/types` arm
 * (`SecurityEffectiveAccessSchema`) accepts only an empty `properties` bag.
 * Outside such a record it renders nothing.
 *
 * Refusals never draw a list: a `403` (a person the caller may not manage, or
 * no such person) and a `501` (a server whose security service does not
 * describe effective access) each leave one quiet line, and any other failure
 * names itself.
 *
 * A direct grant is a stored row: the page lists those rows beside this widget,
 * where each keeps its remove action. Every other origin says where the set
 * comes from (the default binding, a position by name, or the standing the
 * server derived it from).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter, useDataInvalidation, useMetadata, useRecordContext } from '@object-ui/react';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { catalogEntries } from '../../views/setup/peopleAssignments.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type DescribeEffectiveAccess = ReturnType<ObjectStackAdapter['getClient']>['security']['describeEffectiveAccess'];
/** The answer (`EffectiveAccess` of `@objectstack/spec/contracts`, through the client). */
export type EffectiveAccessAnswer = Awaited<ReturnType<DescribeEffectiveAccess>>;
/** One way a set reaches the person (`EffectivePermissionSetOrigin`). */
export type EffectiveAccessOrigin = EffectiveAccessAnswer['permissionSets'][number]['origins'][number];

/** The object whose record pages this widget belongs on. */
export const EFFECTIVE_ACCESS_OBJECT = 'sys_user';

/** The registry type the set labels are read from. */
const PERMISSION_SET_TYPE = 'permission';

type Read =
  | { state: 'loading' }
  | { state: 'ready'; value: EffectiveAccessAnswer }
  | { state: 'refused' }
  | { state: 'unserved' }
  | { state: 'failed'; message: string };

/** The status the client stamps on a refused call (`httpStatus`, from `res.status`). */
function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { httpStatus?: unknown } | null | undefined)?.httpStatus;
  return typeof status === 'number' ? status : undefined;
}

function failureText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : String(err);
}

/** Where one origin says the set comes from. */
export function describeOrigin(origin: EffectiveAccessOrigin, t: Translate): string {
  switch (origin.kind) {
    case 'direct':
      return t('effectiveAccess.origin.direct');
    case 'position':
      return t('effectiveAccess.origin.position', { position: origin.position });
    case 'default':
      return t('effectiveAccess.origin.default');
    case 'derived':
      return origin.source === 'platform_admin_config'
        ? t('effectiveAccess.origin.derivedPlatformAdmin')
        : t('effectiveAccess.origin.derivedAiAccess');
  }
}

/** A stable key for one origin of a row. */
function originKey(origin: EffectiveAccessOrigin): string {
  switch (origin.kind) {
    case 'position':
      return `position-${origin.position}`;
    case 'derived':
      return `derived-${origin.source}`;
    default:
      return origin.kind;
  }
}

export interface UserEffectiveAccessProps {
  /** Carries the scope class of the node's `responsiveStyles`. */
  className?: string;
}

export function UserEffectiveAccess({ className }: UserEffectiveAccessProps = {}) {
  const record = useRecordContext();
  const userId = record?.objectName === EFFECTIVE_ACCESS_OBJECT && record.recordId ? String(record.recordId) : null;
  if (!userId) return null;
  return <EffectiveAccessCard userId={userId} className={className} />;
}

function EffectiveAccessCard({ userId, className }: { userId: string; className?: string }) {
  const { t } = useObjectTranslation();
  const adapter = useAdapter() as ObjectStackAdapter | null;
  const metadata = useMetadata();
  const [read, setRead] = useState<Read>({ state: 'loading' });
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(() => new Map());
  // A grant or a position written on this page changes the answer: read again.
  const grantsNonce = useDataInvalidation('sys_user_permission_set');
  const positionsNonce = useDataInvalidation('sys_user_position');

  useEffect(() => {
    if (!adapter) return;
    let live = true;
    adapter
      .getClient()
      .security.describeEffectiveAccess(userId)
      .then(
        (value) => live && setRead({ state: 'ready', value }),
        (err: unknown) => {
          if (!live) return;
          const status = httpStatusOf(err);
          if (status === 403) setRead({ state: 'refused' });
          else if (status === 501) setRead({ state: 'unserved' });
          else setRead({ state: 'failed', message: failureText(err) });
        },
      );
    return () => {
      live = false;
    };
  }, [adapter, userId, grantsNonce, positionsNonce]);

  // Read the store through a ref: its context value is rebuilt whenever any
  // cached type settles, and the label read must not be keyed on it
  // (ui/AGENTS.md #10).
  const metadataRef = useRef(metadata);
  useEffect(() => {
    metadataRef.current = metadata;
  });

  // Labels only: a set the catalog does not list (or a catalog that fails to
  // load) is shown by its name, never dropped.
  useEffect(() => {
    let live = true;
    void metadataRef.current.ensureType(PERMISSION_SET_TYPE).then(
      (items) => {
        if (live) setLabels(new Map(catalogEntries(items).map((e) => [e.name, e.label] as const)));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(
    () =>
      read.state === 'ready'
        ? read.value.permissionSets.map((set) => ({ ...set, label: labels.get(set.name) ?? set.name }))
        : [],
    [read, labels],
  );

  if (!adapter) return null;

  let body: ReactNode;
  if (read.state === 'loading') {
    body = <Skeleton className="h-12 w-full" data-testid="effective-access-loading" />;
  } else if (read.state === 'refused') {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="effective-access-refused">
        {t('effectiveAccess.refused')}
      </p>
    );
  } else if (read.state === 'unserved') {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="effective-access-unserved">
        {t('effectiveAccess.unserved')}
      </p>
    );
  } else if (read.state === 'failed') {
    body = (
      <p className="flex items-center gap-1 text-sm text-destructive" data-testid="effective-access-failed">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {t('effectiveAccess.loadFailed', { message: read.message })}
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="effective-access-empty">
        {t('effectiveAccess.empty')}
      </p>
    );
  } else {
    body = (
      <ul className="divide-y rounded-md border" data-testid="effective-access-list">
        {rows.map((row) => (
          <li key={row.name} className="flex flex-col gap-1 px-3 py-2" data-testid={`effective-access-row-${row.name}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium">{row.label}</span>
              {row.label !== row.name ? (
                <span className="font-mono text-xs text-muted-foreground">{row.name}</span>
              ) : null}
            </div>
            <ul className="flex flex-wrap gap-1" aria-label={t('effectiveAccess.originsLabel')}>
              {row.origins.map((origin) => (
                <li key={originKey(origin)}>
                  <Badge variant={origin.kind === 'direct' ? 'default' : 'secondary'}>{describeOrigin(origin, t)}</Badge>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card className={cn(className)} data-testid="effective-access">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {t('effectiveAccess.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('effectiveAccess.body')}</p>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

// SDUI registration: a `sys_user` record page names this widget by type.
// Registered under the `security` namespace with no bare fallback, so the one
// key is `security:effective-access`: the spelling a page authors, and the one
// literal its `@object-ui/types` arm claims.
ComponentRegistry.register('effective-access', (props: UserEffectiveAccessProps) => (
  <UserEffectiveAccess className={props.className} />
), {
  namespace: 'security',
  skipFallback: true,
  label: 'Effective Access',
  category: 'plugin',
  inputs: [],
});
