// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DeveloperOverview } from '../components/DeveloperOverview';
import { usePackages } from '../hooks/usePackages';

function PackageIndexComponent() {
  const { package: packageId } = Route.useParams();
  const { packages, selectedPackage } = usePackages(packageId);
  const navigate = useNavigate();

  const onNavigate = (view: string, detail?: string) => {
    // Map common overview links → existing studio routes. Anything we
    // don't have a dedicated page for (e.g. "packages") just stays put.
    const safePackage = packageId;
    switch (view) {
      case 'home':
      case 'overview':
        navigate({ to: `/${safePackage}` as any });
        return;
      case 'objects':
        navigate({ to: `/${safePackage}/objects` as any });
        return;
      case 'object':
        if (detail) navigate({ to: `/${safePackage}/objects/${detail}` as any });
        return;
      case 'views':
      case 'apps':
      case 'forms':
      case 'automations':
      case 'ai':
      case 'security':
      case 'apis':
      case 'playground':
      case 'logs':
        navigate({ to: `/${safePackage}/${view}` as any });
        return;
      default:
        // Unknown destination — no-op rather than 404.
        return;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DeveloperOverview
        packages={packages}
        selectedPackage={selectedPackage}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export const Route = createFileRoute('/$package/')({
  component: PackageIndexComponent,
});
