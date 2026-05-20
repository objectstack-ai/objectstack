// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Page } from '@objectstack/spec/ui';
import { CloneOpportunityAction } from '../actions/opportunity.actions';

/**
 * Opportunity Detail Record Page
 *
 * Salesforce Lightning-style record page for the `opportunity` object.
 * Mirrors the lead_detail blueprint: single-column full-width layout with
 * a Lightning-style header chip, primary action, key highlights strip and
 * status path, then a tab strip below. No sidebar — secondary widgets such
 * as the AI assistant live in the floating console chat instead.
 */
export const OpportunityDetailPage: Page = {
  name: 'opportunity_detail_page',
  label: 'Opportunity Detail',
  description: 'Comprehensive opportunity detail page with path, highlights, details, and related lists',

  type: 'record',
  object: 'opportunity',

  template: 'full-width',

  variables: [
    { name: 'activeTab', type: 'string', defaultValue: 'details' },
  ],

  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          id: 'opp_header',
          label: 'Opportunity Information',
          properties: {
            title: '{name}',
            subtitle: '{account}',
            icon: 'briefcase',
            breadcrumb: true,
          },
        },
        {
          type: 'record:quick_actions',
          id: 'opp_header_actions',
          properties: {
            actions: [CloneOpportunityAction],
            location: 'record_header',
            align: 'end',
          },
        },
        {
          type: 'record:highlights',
          id: 'opp_highlights',
          label: 'Key Information',
          properties: {
            fields: ['amount', 'close_date', 'probability', 'expected_revenue', 'owner', 'account'],
          },
        },
        {
          type: 'record:path',
          id: 'opp_stage_path',
          label: 'Opportunity Stage Path',
          properties: {
            statusField: 'stage',
            stages: [
              { value: 'prospecting', label: 'Prospecting' },
              { value: 'qualification', label: 'Qualification' },
              { value: 'proposal', label: 'Proposal' },
              { value: 'negotiation', label: 'Negotiation' },
              { value: 'closed_won', label: 'Closed Won' },
              { value: 'closed_lost', label: 'Closed Lost' },
            ],
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large',
      components: [
        {
          type: 'page:tabs',
          id: 'opp_main_tabs',
          properties: {
            type: 'line',
            position: 'top',
            items: [
              {
                key: 'details',
                label: 'Details',
                children: [
                  {
                    type: 'record:details',
                    id: 'opp_details',
                    label: 'Opportunity Details',
                    properties: {
                      columns: 2,
                      layout: 'auto',
                      sections: [
                        {
                          label: 'Opportunity Information',
                          fields: ['name', 'account', 'owner', 'type', 'lead_source', 'campaign'],
                        },
                        {
                          label: 'Stage & Forecast',
                          fields: ['stage', 'probability', 'amount', 'expected_revenue', 'close_date', 'forecast_category'],
                        },
                        {
                          label: 'Description',
                          columns: 1,
                          collapsible: true,
                          fields: ['description', 'next_step'],
                        },
                      ],
                    },
                  },
                ],
              },
              {
                key: 'related',
                label: 'Related',
                children: [
                  {
                    type: 'page:accordion',
                    id: 'opp_related_accordion',
                    properties: {
                      items: [
                        {
                          key: 'quotes',
                          label: 'Quotes',
                          children: [
                            {
                              type: 'record:related_list',
                              id: 'opp_quotes',
                              properties: {
                                objectName: 'opportunity_quote',
                                relationshipField: 'opportunity_id',
                                columns: ['quote_number', 'status', 'total_amount', 'expires_at'],
                                limit: 10,
                              },
                            },
                          ],
                        },
                        {
                          key: 'contacts',
                          label: 'Contacts',
                          children: [
                            {
                              type: 'record:related_list',
                              id: 'opp_contacts',
                              properties: {
                                objectName: 'opportunity_contact',
                                relationshipField: 'opportunity_id',
                                columns: ['name', 'role', 'email', 'phone'],
                                limit: 10,
                              },
                            },
                          ],
                        },
                        {
                          key: 'tasks',
                          label: 'Open Tasks',
                          children: [
                            {
                              type: 'record:related_list',
                              id: 'opp_tasks',
                              properties: {
                                objectName: 'opportunity_task',
                                relationshipField: 'opportunity_id',
                                columns: ['subject', 'status', 'due_date', 'assignee'],
                                filter: [{ field: 'status', op: 'neq', value: 'completed' }],
                                limit: 10,
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
              {
                key: 'activity',
                label: 'Activity',
                children: [
                  {
                    type: 'record:activity',
                    id: 'opp_activity',
                    properties: {
                      filters: ['all', 'tasks', 'meetings', 'calls', 'emails'],
                      limit: 25,
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],

  isDefault: true,
  assignedProfiles: ['sales_user', 'sales_manager', 'system_administrator'],

  aria: {
    ariaLabel: 'Opportunity Detail Page',
    ariaDescribedBy: 'Detailed view of opportunity information with related records and activity',
  },
};
