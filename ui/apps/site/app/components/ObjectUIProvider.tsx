'use client';

// Import components to trigger registration
import { initializeComponents } from '@object-ui/components';
// Side-effect import: the module runs `registerAllFields()` at load, which is the
// ONE registration path (objectui#3308). The docs site used to also call
// `registerFields()` here — the demo adapter that re-registered every
// `field:<type>` key wrapped in synthesized label/state chrome, so the docs
// rendered bare field nodes in a way no real application does. Ruling B of
// objectui#3798 removed it: the catalog's field examples are form-hosted
// (`{ type: 'form', fields: [...] }`) and the real form renderer owns the label
// and the value state (objectui#3910).
import '@object-ui/fields';
import { useEffect } from 'react';

export function ObjectUIProvider({ children }: { children: React.ReactNode }) {
  // Explicitly call init to ensure components are registered
  useEffect(() => {
    initializeComponents();
  }, []);

  return <>{children}</>;
}
