// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';
import { Company } from '../objects/company.object.js';
import { Contact } from '../objects/contact.object.js';

// Sample data, so the menu, the boards and the dashboard have something to
// show on first open. Business data: no `mode`, so a replay (each boot, an
// install or upgrade) inserts a missing row and leaves an existing one as the
// organization left it. Delete the rows, or the whole package, when they are
// no longer wanted.

const companies = defineSeed(Company, {
  externalId: 'name',
  records: [
    { name: 'Northwind Trading', type: 'customer', industry: 'retail', phone: '+1-555-0110', website: 'https://northwind.example' },
    { name: 'Blue Harbor Manufacturing', type: 'customer', industry: 'manufacturing', phone: '+1-555-0120', website: 'https://blueharbor.example' },
    { name: 'Summit Analytics', type: 'prospect', industry: 'technology', phone: '+1-555-0130', website: 'https://summit.example' },
    { name: 'Greenfield Clinic', type: 'prospect', industry: 'healthcare', phone: '+1-555-0140' },
    { name: 'Riverside Logistics', type: 'partner', industry: 'other', phone: '+1-555-0150', website: 'https://riverside.example' },
  ],
});

const contacts = defineSeed(Contact, {
  externalId: 'email',
  records: [
    { name: 'Olivia Chen', email: 'olivia@northwind.example', title: 'Purchasing Manager', influence: 'decision_maker', company: 'Northwind Trading', phone: '+1-555-0111' },
    { name: 'Daniel Park', email: 'daniel@northwind.example', title: 'Store Operations Lead', influence: 'user', company: 'Northwind Trading' },
    { name: 'Sophia Martin', email: 'sophia@blueharbor.example', title: 'Plant Director', influence: 'decision_maker', company: 'Blue Harbor Manufacturing', phone: '+1-555-0121' },
    { name: 'Liam Turner', email: 'liam@summit.example', title: 'CTO', influence: 'influencer', company: 'Summit Analytics' },
    { name: 'Emma Wilson', email: 'emma@greenfield.example', title: 'Office Manager', influence: 'other', company: 'Greenfield Clinic' },
    { name: 'Noah Garcia', email: 'noah@riverside.example', title: 'Partnership Manager', influence: 'decision_maker', company: 'Riverside Logistics', phone: '+1-555-0151' },
  ],
});

export const StarterSeedData = [companies, contacts];
