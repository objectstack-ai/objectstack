/**
 * Dev-only harness for lookup cells in line-item grids (SDUI follow-up):
 * a LineItemsField whose first column is a real lookup picker bound to live
 * showcase_account. Not part of the product nav.
 */
import React from 'react';
import { LineItemsField } from '@object-ui/fields';

export const DevLookup: React.FC = () => {
  const [rows, setRows] = React.useState<Record<string, any>[]>([{}, {}]);
  const field = {
    columns: [
      { name: 'account', label: 'Account', type: 'lookup', reference: 'showcase_account', displayField: 'name' },
      { name: 'note', label: 'Note', type: 'text' },
      { name: 'amount', label: 'Amount', type: 'currency' },
    ],
    totalField: 'amount',
  } as any;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Dev · Line-item grid with a lookup cell</h1>
      <p className="text-sm text-muted-foreground">
        The <code>Account</code> column is a real lookup picker bound to live <code>showcase_account</code>.
      </p>
      <LineItemsField value={rows} onChange={setRows} field={field} />
      <pre className="rounded bg-muted p-3 text-xs" data-testid="rows-json">
        {JSON.stringify(rows)}
      </pre>
    </div>
  );
};

export default DevLookup;
