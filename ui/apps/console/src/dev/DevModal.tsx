/**
 * Dev-only harness for the action modal transport (SDUI opt #2):
 * one handler, four placements (center / side / bottom / fullscreen), each
 * rendering arbitrary SchemaNode content. Not part of the product nav.
 */
import React from 'react';
import { Button } from '@object-ui/components';
import { useActionModal } from '@object-ui/app-shell';

const content = {
  type: 'element:definition-list',
  properties: {
    columns: 2,
    items: [
      { term: 'Status', description: 'Active' },
      { term: 'Owner', description: 'Ada Lovelace' },
      { term: 'Plan', description: 'Enterprise' },
      { term: 'Renewal', description: '2026-12-01' },
    ],
  },
};

export const DevModal: React.FC = () => {
  const { modalHandler, modalElement } = useActionModal();
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-lg font-semibold">Dev · Action modal transport</h1>
      <p className="text-sm text-muted-foreground">
        One <code>onModal</code> handler, four placements, arbitrary SchemaNode content.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="open-center" onClick={() => modalHandler({ placement: 'center', size: 'lg', title: 'Center modal', content })}>
          Center
        </Button>
        <Button data-testid="open-side" variant="outline" onClick={() => modalHandler({ placement: 'side', title: 'Side drawer', content })}>
          Side drawer
        </Button>
        <Button data-testid="open-bottom" variant="outline" onClick={() => modalHandler({ placement: 'bottom', title: 'Bottom sheet', content })}>
          Bottom sheet
        </Button>
        <Button data-testid="open-fullscreen" variant="outline" onClick={() => modalHandler({ placement: 'fullscreen', title: 'Fullscreen', content })}>
          Fullscreen
        </Button>
      </div>
      {modalElement}
    </div>
  );
};

export default DevModal;
