// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A recorded OData service for tests: each exchange is a request the driver
 * is expected to send and the response the service answered. A request no
 * exchange names fails the test with the request spelled out, so a
 * translation change shows up as the exact URL that moved.
 *
 * URLs are written DECODED and relative to {@link SERVICE_ROOT}
 * (`People?$filter=FirstName eq 'Russell'`), which is how they read in the
 * OData specification; the matcher decodes the request before comparing.
 */

import { readFileSync } from 'node:fs';
import type { FetchLike } from '../transport.js';

export const SERVICE_ROOT = 'https://odata.example.test/TripPinRESTierService/';

export const TRIPPIN_METADATA = readFileSync(new URL('./trippin-metadata.xml', import.meta.url), 'utf8');

export interface Exchange {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Decoded, relative to {@link SERVICE_ROOT}. */
  url: string;
  status?: number;
  /** JSON-serialised unless a string. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Answer this exchange once, then fall through to the next match. */
  once?: boolean;
}

export interface RecordedRequest {
  method: string;
  /** Decoded, relative to {@link SERVICE_ROOT} when under it. */
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export const METADATA_EXCHANGE: Exchange = { url: '$metadata', body: TRIPPIN_METADATA, headers: { 'Content-Type': 'application/xml' } };

const relative = (url: string, root: string) => {
  const decoded = decodeURIComponent(url);
  return decoded.startsWith(root) ? decoded.slice(root.length) : decoded;
};

/** `root`: the service root the exchanges are written relative to (TripPin's by default). */
export function recordedService(exchanges: Exchange[], root: string = SERVICE_ROOT): { fetch: FetchLike; requests: RecordedRequest[] } {
  const pending = [...exchanges];
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const method = init.method ?? 'GET';
    const url = relative(input, root);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, url, headers, ...(body !== undefined ? { body } : {}) });
    const index = pending.findIndex((e) => (e.method ?? 'GET') === method && e.url === url);
    if (index < 0) throw new Error(`recorded service: no exchange recorded for ${method} ${url}`);
    const exchange = pending[index]!;
    if (exchange.once) pending.splice(index, 1);
    const text = exchange.body === undefined
      ? null
      : typeof exchange.body === 'string' ? exchange.body : JSON.stringify(exchange.body);
    return new Response(text, {
      status: exchange.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...exchange.headers },
    });
  };
  return { fetch, requests };
}

/** TripPin's People, as the service answers them (abridged to five, Emails and AddressInfo kept). */
export const PEOPLE = [
  {
    '@odata.etag': 'W/"08D8D4E1A3B1C2F0"',
    UserName: 'russellwhyte', FirstName: 'Russell', LastName: 'Whyte', MiddleName: null,
    Gender: 'Male', Age: null, Emails: ['Russell@example.com', 'Russell@contoso.com'],
    AddressInfo: [{ Address: '187 Suffolk Ln.', City: { Name: 'Boise', CountryRegion: 'United States', Region: 'ID' } }],
    Concurrency: 0,
  },
  {
    '@odata.etag': 'W/"08D8D4E1A3B1C2F1"',
    UserName: 'scottketchum', FirstName: 'Scott', LastName: 'Ketchum', MiddleName: null,
    Gender: 'Male', Age: null, Emails: ['Scott@example.com'],
    AddressInfo: [{ Address: '2817 Milton Dr.', City: { Name: 'Albuquerque', CountryRegion: 'United States', Region: 'NM' } }],
    Concurrency: 1,
  },
  {
    '@odata.etag': 'W/"08D8D4E1A3B1C2F2"',
    UserName: 'ronaldmundy', FirstName: 'Ronald', LastName: 'Mundy', MiddleName: null,
    Gender: 'Male', Age: null, Emails: ['Ronald@example.com', 'Ronald@contoso.com'],
    AddressInfo: [], Concurrency: 2,
  },
  {
    '@odata.etag': 'W/"08D8D4E1A3B1C2F3"',
    UserName: 'javieralfred', FirstName: 'Javier', LastName: 'Alfred', MiddleName: null,
    Gender: 'Male', Age: null, Emails: ['Javier@example.com', 'Javier@contoso.com'],
    AddressInfo: [{ Address: '89 Jefferson Way Suite 2', City: { Name: 'Portland', CountryRegion: 'United States', Region: 'WA' } }],
    Concurrency: 3,
  },
  {
    '@odata.etag': 'W/"08D8D4E1A3B1C2F4"',
    UserName: 'willieashmore', FirstName: 'Willie', LastName: 'Ashmore', MiddleName: null,
    Gender: 'Male', Age: null, Emails: ['Willie@example.com', 'Willie@contoso.com'],
    AddressInfo: [], Concurrency: 4,
  },
] as const;

/** A collection envelope as TripPin writes one. */
export function page(rows: readonly unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { '@odata.context': `${SERVICE_ROOT}$metadata#People`, value: rows, ...extra };
}
