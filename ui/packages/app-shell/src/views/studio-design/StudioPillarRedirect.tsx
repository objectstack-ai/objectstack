// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36909 — the route element for `/studio/:packageId` and
 * `/studio/:packageId/:tab`: a retired pillar address redirects, in one hop,
 * to the page that replaced it (`studioPillarRedirectModel.ts` holds the table);
 * any other segment renders `children`, the page that answers to it (the
 * builder, which draws the sharing overview or the not-found state).
 *
 * The router state the address arrived with travels with it, except where
 * the redirect writes its own (the retired Interfaces landing's notice).
 */

import * as React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { AccessPillarLanding } from './accessPillarLanding.js';
import { studioPillarRedirect } from './studioPillarRedirectModel.js';

export function StudioPillarRedirect({ children }: { children?: React.ReactNode }): React.ReactElement | null {
  const { packageId, tab } = useParams<{ packageId?: string; tab?: string }>();
  const location = useLocation();
  const target = studioPillarRedirect(packageId, tab, location.search);
  if (target === null) return <>{children}</>;
  if (target.kind === 'access') {
    return (
      <AccessPillarLanding
        key={`${target.packageId}${location.search}`}
        packageId={target.packageId}
        search={location.search}
        state={location.state}
      />
    );
  }
  return <Navigate to={target.to} state={target.state ?? location.state} replace />;
}
