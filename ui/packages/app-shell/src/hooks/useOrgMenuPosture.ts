/**
 * useOrgMenuPosture — which organization entries the avatar menu offers, read
 * from the deployment signals the server already serves on `GET /auth/config`
 * (objectstack-ai/objectstack#34591, ruling 6937513776):
 *
 * - `features.multiOrgEnabled` — the multi-organization capability flag. The
 *   server derives it from the effective tenancy posture (`false` on `single`,
 *   and on a degraded deployment that asked for isolation but has none), and
 *   the spec says the console offers creating, switching and leaving
 *   organizations only when it is on. It is default-on: absent reads as on.
 * - `features.cloudManaged` — the cloud's control plane runs this environment.
 *   Organizations are created on the cloud there, so the console offers no
 *   create entry; the cloud adds its own entries through the existing
 *   `manifest.navigationContributions` path, never through this menu. Absent
 *   reads as not managed.
 * - `features.tenancyPosture` — how to render organization context (ADR-0105
 *   D1): under `group` the switcher picks the WRITE target, so it says so.
 *
 * There is no Setup override: the menu follows the served signals alone (the
 * ruling drops the card's settings key). Single-organization member
 * management stays reachable at Setup → Organization (ruling 6384629949), so a
 * single-tenant menu without organization entries closes no door.
 *
 * Until the config resolves the defaults are the spec's absent readings
 * (multi-organization on, not managed), which is today's rendering.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import type { AuthPublicConfig, TenancyPosture } from '@object-ui/auth';

const POSTURES: readonly TenancyPosture[] = ['single', 'group', 'isolated'];

export interface OrgMenuPosture {
  /** `features.multiOrgEnabled !== false` — the spec's default-on reading. */
  multiOrgEnabled: boolean;
  /** `features.cloudManaged === true`. */
  cloudManaged: boolean;
  /** `features.tenancyPosture` when it is a recognised posture, else `undefined`. */
  tenancyPosture: TenancyPosture | undefined;
}

const UNRESOLVED: OrgMenuPosture = {
  multiOrgEnabled: true,
  cloudManaged: false,
  tenancyPosture: undefined,
};

/** The served `features` object, read into the three answers above. */
export function readOrgMenuPosture(features: AuthPublicConfig['features'] | null | undefined): OrgMenuPosture {
  const posture: unknown = features?.tenancyPosture;
  return {
    multiOrgEnabled: features?.multiOrgEnabled !== false,
    cloudManaged: features?.cloudManaged === true,
    tenancyPosture:
      typeof posture === 'string' && (POSTURES as readonly string[]).includes(posture)
        ? (posture as TenancyPosture)
        : undefined,
  };
}

export interface OrgMenuEntries {
  /** "My Organizations" → `/organizations?manage=1`. */
  myOrganizations: boolean;
  /** "Switch organization" — the organization switcher, inside the avatar menu. */
  switchOrganization: boolean;
  /** "Create organization" → `/organizations?create=1`. */
  createOrganization: boolean;
}

/**
 * The avatar menu's organization entries for one deployment and one member.
 *
 * - single-tenant (`multiOrgEnabled` off) ⇒ none;
 * - multi-organization ⇒ My Organizations and Create organization, plus Switch
 *   organization only at two or more memberships (one has nothing to switch to);
 * - cloud-managed ⇒ no Create organization.
 *
 * `hasOrgSection` is the member's own organization context (memberships still
 * loading, any membership, or an active organization): with none there is
 * nothing to manage or switch, as before.
 */
export function orgMenuEntries(input: {
  posture: Pick<OrgMenuPosture, 'multiOrgEnabled' | 'cloudManaged'>;
  hasOrgSection: boolean;
  membershipCount: number;
}): OrgMenuEntries {
  const offered = input.posture.multiOrgEnabled && input.hasOrgSection;
  return {
    myOrganizations: offered,
    switchOrganization: offered && input.membershipCount > 1,
    createOrganization: offered && !input.posture.cloudManaged,
  };
}

export function useOrgMenuPosture(): OrgMenuPosture {
  const { getAuthConfig } = useAuth();
  const [posture, setPosture] = useState<OrgMenuPosture>(UNRESOLVED);

  useEffect(() => {
    let cancelled = false;
    getAuthConfig?.()
      .then((cfg) => {
        if (!cancelled) setPosture(readOrgMenuPosture(cfg?.features));
      })
      .catch(() => {
        /* config unavailable — keep the absent readings; the server still enforces */
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  return posture;
}
