// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';
import { Account } from '../objects/account.object.js';
import { Contact } from '../objects/contact.object.js';
import { Opportunity } from '../objects/opportunity.object.js';
import { Lead } from '../objects/lead.object.js';
import { Activity } from '../objects/activity.object.js';

const accounts = defineSeed(Account, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Acme Corp',     industry: 'technology', annual_revenue: 5_000_000, website: 'https://acme.example' },
    { name: 'Globex Ltd',    industry: 'finance',    annual_revenue: 12_000_000, website: 'https://globex.example' },
    { name: 'Initech',       industry: 'technology', annual_revenue: 2_500_000, website: 'https://initech.example' },
  ],
});

const contacts = defineSeed(Contact, {
  mode: 'upsert',
  externalId: 'email',
  records: [
    { first_name: 'Ada',    last_name: 'Lovelace', email: 'ada@acme.example',    account: 'Acme Corp' },
    { first_name: 'Linus',  last_name: 'Torvalds', email: 'linus@globex.example', account: 'Globex Ltd' },
    { first_name: 'Grace',  last_name: 'Hopper',   email: 'grace@initech.example', account: 'Initech' },
  ],
});

const opportunities = defineSeed(Opportunity, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    // --- Open pipeline (no close yet) -----------------------------------
    { name: 'Acme — Q3 Platform Renewal', account: 'Acme Corp',  stage: 'proposal',       amount: 120_000, probability: 70, close_date: cel`daysFromNow(30)` },
    { name: 'Globex — New CRM Rollout',   account: 'Globex Ltd', stage: 'qualification',  amount: 450_000, probability: 40, close_date: cel`daysFromNow(60)` },
    { name: 'Initech — Expansion',        account: 'Initech',    stage: 'prospecting',    amount:  80_000, probability: 20, close_date: cel`daysFromNow(45)` },
    { name: 'Acme — Add-on Module',       account: 'Acme Corp',  stage: 'qualification',  amount:  60_000, probability: 35, close_date: cel`daysFromNow(20)` },

    // --- Recently closed-won (current quarter — drives "Won This Quarter") -
    { name: 'Initech — Pilot',                  account: 'Initech',    stage: 'closed_won', amount:  35_000, probability: 100, close_date: cel`daysAgo(7)` },
    { name: 'Acme — Support Tier Upgrade',      account: 'Acme Corp',  stage: 'closed_won', amount:  90_000, probability: 100, close_date: cel`daysAgo(14)` },
    { name: 'Globex — Analytics Pack',          account: 'Globex Ltd', stage: 'closed_won', amount: 110_000, probability: 100, close_date: cel`daysAgo(21)` },

    // --- Previous-quarter wins (drives the "vs last quarter" comparison) ---
    { name: 'Initech — POC',                    account: 'Initech',    stage: 'closed_won', amount:  25_000, probability: 100, close_date: cel`daysAgo(95)` },
    { name: 'Globex — Initial Seats',           account: 'Globex Ltd', stage: 'closed_won', amount: 145_000, probability: 100, close_date: cel`daysAgo(110)` },

    // --- Prior-year wins in the same window (drives "YoY" comparison) ------
    { name: 'Acme — Year-Ago Renewal',          account: 'Acme Corp',  stage: 'closed_won', amount:  75_000, probability: 100, close_date: cel`daysAgo(380)` },
    { name: 'Globex — Year-Ago Implementation', account: 'Globex Ltd', stage: 'closed_won', amount: 210_000, probability: 100, close_date: cel`daysAgo(400)` },

    // --- Closed lost (kept out of pipeline sum) ----------------------------
    { name: 'Initech — Cancelled Eval',         account: 'Initech',    stage: 'closed_lost', amount: 15_000, probability: 0, close_date: cel`daysAgo(30)` },
  ],
});

const leads = defineSeed(Lead, {
  mode: 'upsert',
  externalId: 'email',
  // No `assigned_to` on these rows. It is a user field, and no user exists
  // when the seed runs: people come from sign-up, and the dev admin is
  // created after the seed. A rep picks up a lead from the record page.
  records: [
    // New / uncontacted
    {
      name: 'Marie Curie', email: 'marie@radium.example', company: 'Radium Labs',
      title: 'Director of Research', phone: '+1-555-0101',
      status: 'new', source: 'web', lead_score: 0,
      account: 'Acme Corp',
    },
    // In qualification — high-value referral lead
    {
      name: 'Alan Turing', email: 'alan@bletchley.example', company: 'Bletchley Systems',
      title: 'VP Engineering', phone: '+44-20-555-0202',
      status: 'qualifying', source: 'referral', lead_score: 75,
    },
    // Qualified — ready for conversion
    {
      name: 'Rosalind Franklin', email: 'ros@helix.example', company: 'Helix Analytics',
      title: 'CTO', phone: '+1-555-0303',
      status: 'qualified', source: 'event', lead_score: 85,
      account: 'Initech',
    },
    // Disqualified — poor fit
    {
      name: 'Thomas Edison', email: 'tom@menlo.example', company: 'Menlo Workshop',
      title: 'Founder', phone: '+1-555-0404',
      status: 'disqualified', source: 'cold_outreach', lead_score: 25,
      notes: 'Company too small; no budget this year.',
    },
    // Already converted — linked to an Opportunity
    {
      name: 'Nikola Tesla', email: 'nikola@wardenclyffe.example', company: 'Wardenclyffe Corp',
      title: 'Chief Inventor', phone: '+1-555-0505',
      status: 'converted', source: 'partner', lead_score: 90,
      converted_opportunity: 'Acme — Q3 Platform Renewal',
    },
  ],
});

const activities = defineSeed(Activity, {
  mode: 'upsert',
  externalId: 'subject',
  records: [
    {
      subject: 'Discovery Call — Acme Platform Renewal',
      type: 'call', status: 'completed',
      due_date: cel`daysAgo(3)`,
      contact: 'ada@acme.example',
      account: 'Acme Corp',
      opportunity: 'Acme — Q3 Platform Renewal',
      duration_minutes: 45,
      outcome: 'Strong interest confirmed; sending proposal next week.',
    },
    {
      subject: 'Product Demo — Globex New CRM',
      type: 'meeting', status: 'planned',
      due_date: cel`daysFromNow(5)`,
      contact: 'linus@globex.example',
      account: 'Globex Ltd',
      opportunity: 'Globex — New CRM Rollout',
      duration_minutes: 90,
      description: 'Full platform walkthrough with IT and operations stakeholders.',
    },
    {
      subject: 'Follow-up Email — Initech Expansion',
      type: 'email', status: 'completed',
      due_date: cel`daysAgo(7)`,
      contact: 'grace@initech.example',
      account: 'Initech',
      opportunity: 'Initech — Expansion',
      outcome: 'Sent pricing breakdown; awaiting procurement sign-off.',
    },
    {
      subject: 'Proposal Review — Helix Analytics',
      type: 'task', status: 'in_progress',
      due_date: cel`daysFromNow(2)`,
      contact: 'grace@initech.example',
      account: 'Initech',
      description: 'Prepare and review the commercial proposal before sending to Helix.',
    },
    {
      subject: 'Quarterly Business Review — Acme Corp',
      type: 'meeting', status: 'planned',
      due_date: cel`daysFromNow(14)`,
      contact: 'ada@acme.example',
      account: 'Acme Corp',
      duration_minutes: 60,
      description: 'QBR covering renewal roadmap and upsell opportunities.',
    },
  ],
});

export const CrmSeedData = [accounts, contacts, opportunities, leads, activities];
