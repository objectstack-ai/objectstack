import type { AuthOrganization } from '@object-ui/auth';
import { useOutletContext } from 'react-router-dom';

export interface OrgOutletContext {
  org: AuthOrganization;
}

export function useOrgContext(): OrgOutletContext {
  return useOutletContext<OrgOutletContext>();
}
