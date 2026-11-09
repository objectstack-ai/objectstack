// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * Exchange Rate Sync — a TEMPLATE for keeping `sys_exchange_rate` current from
 * a rates feed (multi-currency, ADR-0144).
 *
 * The platform ships no rates feed and never calls one: rates are typed in
 * Setup → Exchange Rates, imported from a file, or written by an app. This flow
 * is the "written by an app" kind, as an example a customer copies and turns
 * on. Once a day it reads a JSON feed and writes one rate row per currency,
 * marked `source: 'app'`.
 *
 * ## The feed, and what it must say
 *
 * The rate direction is the platform's one direction: 1 unit of the home
 * currency = `rate` units of the foreign currency. So the feed must be quoted
 * FROM the organization's home currency. The default below reads the
 * Frankfurter API (European Central Bank reference rates) from USD, the home
 * currency this example pins in `.env`; its answer is
 * `{ "base": "USD", "date": "YYYY-MM-DD", "rates": { "EUR": 0.92, ... } }`.
 * A feed quoted the other way round would store every rate inverted.
 *
 * ## Where the customer changes the URL
 *
 * `rate_feed_url` is the setting: the `http` node's `url` is the text slot
 * `{{ rate_feed_url }}`, and the variable's `defaultValue` is the URL. Change
 * it in Studio (Automation → this flow → Variables) to point at the bank or
 * provider the company reconciles against, and to quote from its own home
 * currency. A URL whose path or query carries a secret does not belong here:
 * the flow definition is readable by everyone who can read flows, so a
 * credentialed feed goes through a connector, whose credential lives outside
 * the definition (`src/system/connectors/index.ts`).
 *
 * ## What one run does
 *
 *  1. `fetch_rates` GETs the feed.
 *  2. `to_rows` turns the feed's `rates` map into a list of
 *     `{ currency, rate }` entries, one per currency the feed quotes.
 *  3. `each_rate` writes one `sys_exchange_rate` row per entry, dated with
 *     the feed's own `date` (the day the rates are for, not the day the flow
 *     ran). The table holds one row per (currency, effective date), so a
 *     second run on the same feed day is refused row by row; each write sits
 *     in its own `try_catch`, so a day already loaded is skipped and a run
 *     never stops halfway through the list.
 *
 * Converted amounts do not move when a new rate arrives: an invoice keeps the
 * rate in force on its own document date (`invoice_date`). A corrected rate
 * reaches amounts already stored only through an explicit recompute
 * (`os migrate recompute-home-amounts`).
 *
 * ## Why it ships switched off
 *
 * `status: 'obsolete'` is the platform's "loaded, not armed": Studio lists
 * and opens the flow and its on/off switch reads Off, and no trigger fires it.
 * A shipped example must not call a third-party service on every developer's
 * boot and in CI. To use it, switch it on in Studio. Scheduled work shipped
 * in a package also needs the deployment switch
 * `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` (see `ScheduledDigestFlow` in
 * `./index.ts` for that rule and the tenancy posture it depends on).
 *
 * The flow writes an administrators' object: only an organization
 * administrator may write exchange rates, so the run is `runAs: 'system'`, the
 * principal a schedule runs as when no user started it.
 */
export const ExchangeRateSyncFlow = defineFlow({
  name: 'showcase_exchange_rate_sync',
  label: 'Exchange Rate Sync (template)',
  description:
    'Once a day, reads exchange rates from a feed quoted from the home currency and writes them to Setup → Exchange Rates (source: app). A template: switch it on and point rate_feed_url at your provider.',
  type: 'schedule',
  status: 'obsolete',
  runAs: 'system',
  variables: [
    {
      name: 'rate_feed_url',
      type: 'text',
      isInput: false,
      isOutput: false,
      defaultValue: 'https://api.frankfurter.app/latest?from=USD',
    },
  ],
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Daily at 06:00',
      config: {
        schedule: { type: 'cron', expression: '0 6 * * *' },
      },
    },
    {
      id: 'fetch_rates',
      type: 'http',
      label: 'Fetch Rates',
      config: {
        url: '{{ rate_feed_url }}',
        method: 'GET',
      },
    },
    {
      id: 'to_rows',
      type: 'assignment',
      label: 'One Entry per Currency',
      config: {
        assignments: {
          // A CEL comprehension over the map's keys. Each entry keeps the
          // feed's number as is: the rate table refuses a zero or negative
          // rate, and one with more than twelve decimals, so a bad quote is
          // refused at the write and never stored rounded.
          rate_rows: {
            dialect: 'cel',
            source: "fetch_rates.response.rates.map(c, {'currency': c, 'rate': dyn(fetch_rates.response.rates[c])})",
          },
          rate_date: { dialect: 'cel', source: 'fetch_rates.response.date' },
        },
      },
    },
    {
      id: 'each_rate',
      type: 'loop',
      label: 'For Each Currency',
      config: {
        collection: { dialect: 'cel', source: 'rate_rows' },
        iteratorVariable: 'row',
        maxIterations: 200,
        body: {
          nodes: [
            {
              id: 'guard_write',
              type: 'try_catch',
              label: 'Skip a Day Already Loaded',
              config: {
                try: {
                  nodes: [
                    {
                      id: 'write_rate',
                      type: 'create_record',
                      label: 'Write Exchange Rate',
                      config: {
                        objectName: 'sys_exchange_rate',
                        fields: {
                          currency: { dialect: 'cel', source: 'row.currency' },
                          rate: { dialect: 'cel', source: 'row.rate' },
                          effective_date: { dialect: 'cel', source: 'rate_date' },
                          source: 'app',
                        },
                      },
                    },
                  ],
                  edges: [],
                },
                catch: {
                  nodes: [{ id: 'rate_skipped', type: 'assignment', label: 'Rate Skipped' }],
                },
              },
            },
          ],
          edges: [],
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'fetch_rates' },
    { id: 'e2', source: 'fetch_rates', target: 'to_rows' },
    { id: 'e3', source: 'to_rows', target: 'each_rate' },
    { id: 'e4', source: 'each_rate', target: 'end' },
  ],
});
