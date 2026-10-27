/**
 * Identity import and the managed-environment Users marker of the Console
 * `ObjectView` (`./ObjectView.tsx`): the gate that wires the import wizard to
 * the auth service's import pipeline for `sys_user`, its password-policy state
 * and data source, and the per-row marker on a managed environment's Users
 * list, moved out of `ObjectViewInner` verbatim (objectstack#25992, slice 5).
 * Every input is passed in; the component reads the returned values.
 */

import { useState, useRef, useMemo, useCallback } from 'react';
import type { DataSource } from '@object-ui/types';
import { useMetadata } from '@object-ui/react';
import { createIdentityImportDataSource, IDENTITY_IMPORT_OBJECT, type IdentityPasswordPolicy } from './identityImport.js';
import { MANAGED_USERS_OBJECT, UnauthorizedUserMarker, UserGrantLoader, isManagedEnvironment } from './managedEnvironmentUsers.js';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import type { ConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';

export function useObjectViewIdentity({ objectDef, isAdmin, dataSource, refreshKey, t, actionRuntime }: {
    objectDef: { name: string };
    isAdmin: boolean;
    dataSource: DataSource;
    refreshKey: number;
    t: (key: string, opts?: Record<string, unknown>) => string;
    actionRuntime: Pick<ConsoleActionRuntime, 'authFetch'>;
}) {
    // ─── Identity import (framework#2782) ────────────────────────────────
    // sys_user's generic import affordance stays FALSE (a data-layer insert
    // would bypass better-auth's hashing and never create a credential), but
    // platform admins get the same wizard wired to the dedicated
    // /api/v1/auth/admin/import-users pipeline. Gated on the deployment's
    // admin surface (features.admin from /api/v1/auth/config) plus the
    // caller being a workspace admin (the server re-checks, ADR-0068).
    // objectui#13330 — and never on a managed environment
    // (`features.cloudManaged`): there the server answers `admin/import-users`
    // with 409 `RESOURCE_CONFLICT`, because people arrive from the hosting
    // organisation through its identity provider.
    const { features } = useExpressionContext();
    const isIdentityImport = objectDef.name === IDENTITY_IMPORT_OBJECT;
    const identityImportEnabled =
        isIdentityImport && features?.admin === true && isAdmin && !isManagedEnvironment(features);

    // ─── Setup → Users on a managed environment (objectui#13330) ─────────
    // The line that says where people are invited, and the marker on a user
    // who holds no permission set beyond the baseline. The marker reads the
    // grant rows through one loader per list (`managedEnvironmentUsers.tsx`),
    // rebuilt when the list refreshes, so a grant made elsewhere shows on the
    // next load. The metadata store is read through a ref: its context value is
    // rebuilt whenever any cached type settles (AGENTS.md #10).
    const managedUsers = objectDef.name === MANAGED_USERS_OBJECT && isManagedEnvironment(features);
    const metadataStore = useMetadata();
    const metadataStoreRef = useRef(metadataStore);
    metadataStoreRef.current = metadataStore;
    const grantLoaderRef = useRef<{ refreshKey: number; source: unknown; loader: UserGrantLoader } | null>(null);
    if (
        managedUsers &&
        dataSource &&
        (grantLoaderRef.current?.refreshKey !== refreshKey || grantLoaderRef.current?.source !== dataSource)
    ) {
        grantLoaderRef.current = {
            refreshKey,
            source: dataSource,
            loader: new UserGrantLoader(dataSource as any, {
                ensureType: (type: string) => metadataStoreRef.current.ensureType(type),
                getTypeStatus: (type: string) => metadataStoreRef.current.getTypeStatus?.(type) ?? 'ready',
            }),
        };
    }
    const grantLoader = managedUsers ? grantLoaderRef.current?.loader : undefined;
    const managedUserMarker = useCallback(
        (row: Record<string, unknown>) => {
            const id = row?.id ?? row?._id;
            if (!grantLoader || id === undefined || id === null || id === '') return null;
            return <UnauthorizedUserMarker loader={grantLoader} userId={String(id)} t={t} />;
        },
        [grantLoader, t],
    );
    const [identityPasswordPolicy, setIdentityPasswordPolicy] = useState<IdentityPasswordPolicy>('auto');
    const identityPolicyRef = useRef<IdentityPasswordPolicy>('auto');
    identityPolicyRef.current = identityPasswordPolicy;
    const identityDataSource = useMemo(
      () => (identityImportEnabled
        ? createIdentityImportDataSource({
            base: dataSource,
            authFetch: actionRuntime.authFetch,
            baseUrl: import.meta.env.VITE_SERVER_URL || '',
            getPasswordPolicy: () => identityPolicyRef.current,
          })
        : undefined),
      [identityImportEnabled, dataSource, actionRuntime.authFetch],
    );
    return {
        identityImportEnabled,
        managedUsers,
        managedUserMarker,
        identityPasswordPolicy,
        setIdentityPasswordPolicy,
        identityDataSource,
    };
}
