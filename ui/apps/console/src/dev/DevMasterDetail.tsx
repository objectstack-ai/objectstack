/**
 * Dev-only harness for ADR-0001 (master-detail subform). Renders the
 * `object-master-detail-form` SDUI component against the live backend's
 * expense_claim (parent) + expense_line (child, master_detail) so the
 * capability can be verified end-to-end. Not part of the product nav.
 */
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';

const schema = {
  type: 'object-master-detail-form',
  objectName: 'expense_claim',
  mode: 'create',
  formType: 'simple',
  title: 'New Expense Claim',
  submitText: 'Create Claim',
  fields: ['title', 'applicant', 'department', 'reason', 'currency', 'claim_status', 'payment_status', 'remarks'],
  details: [
    {
      title: 'Expense Lines',
      childObject: 'expense_line',
      relationshipField: 'expense_claim',
      amountField: 'amount',
      totalField: 'total_amount',
      columns: [
        { name: 'expense_date', label: 'Date', type: 'date' },
        {
          name: 'category',
          label: 'Category',
          type: 'select',
          options: [
            { label: 'Travel & Transport', value: 'travel_transport' },
            { label: 'Lodging', value: 'lodging' },
            { label: 'Meals & Entertainment', value: 'meals_entertainment' },
            { label: 'Office Supplies', value: 'office_supplies' },
            { label: 'Communications', value: 'communications' },
            { label: 'Training & Conference', value: 'training_conference' },
            { label: 'Client / Project', value: 'client_project' },
            { label: 'Other', value: 'other' },
          ],
        },
        { name: 'description', label: 'Description', type: 'text' },
        { name: 'merchant_vendor', label: 'Merchant', type: 'text' },
        { name: 'amount', label: 'Amount', type: 'currency' },
      ],
    },
  ],
};

export const DevMasterDetail: React.FC = () => (
  <div className="mx-auto max-w-3xl p-6">
    <h1 className="mb-4 text-lg font-semibold">Dev · Master-Detail Form (ADR-0001)</h1>
    <SchemaRenderer schema={schema as any} />
  </div>
);

export default DevMasterDetail;
