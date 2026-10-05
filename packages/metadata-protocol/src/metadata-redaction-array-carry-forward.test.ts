// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `/meta` PUT carry-forward ({@link carryForwardRedactedValues}) through
 * arrays whose elements carry no `id`: a datasource of a driver the platform
 * ships no config contract for has its credentials withheld inside array
 * elements (`config.servers.<i>.password`), inside a header tuple
 * (`config.headers.<i>.<j>`, an array inside an array) and as an array element
 * itself (`config.headers.<i>` in a raw-headers list).
 *
 * An unchanged GET → PUT keeps every one of them; an edit carries a value only
 * onto the element it came from — the same rule as the datasource admin
 * service's `restoreRedactedConfig` — and drops it where that element changed,
 * is gone, or cannot be told apart from another.
 */

import { describe, expect, it } from 'vitest';
import { carryForwardRedactedValues, redactMetadataItem } from './metadata-redaction.js';

const DRIVER = 'com.vendor.warehouse';

const STORED = {
  name: 'warehouse',
  driver: DRIVER,
  config: {
    host: 'h',
    servers: [{ host: 'a', password: 'p-a' }, { host: 'b', password: 'p-b' }],
    headers: [{ name: 'Authorization', value: 'Bearer h-1' }, { name: 'Accept', value: 'application/json' }],
    tuples: [['Accept', 'json'], ['Authorization', 'Bearer t-1']],
    rawHeaders: ['Authorization', 'Bearer r-1', 'Accept', 'json'],
  },
};

/** What the read exits serve for STORED. */
const served = () => structuredClone(redactMetadataItem('datasource', STORED));

/** `served()` with its `config` replaced key by key. */
const edited = (config: Record<string, unknown>) => {
  const item = served();
  return { ...item, config: { ...item.config, ...config } };
};

const carry = (incoming: unknown) =>
  carryForwardRedactedValues('datasource', incoming, STORED) as { config: Record<string, unknown> };

describe('the /meta carry-forward through id-less array elements and nested arrays', () => {
  it('the served body withholds every array-borne credential', () => {
    expect(served().config).toEqual({
      host: 'h',
      servers: [{ host: 'a' }, { host: 'b' }],
      headers: [{ name: 'Authorization' }, { name: 'Accept', value: 'application/json' }],
      tuples: [['Accept', 'json'], ['Authorization']],
      rawHeaders: ['Authorization', null, 'Accept', 'json'],
    });
  });

  it('an unchanged GET → PUT of a legacy row deletes nothing', () => {
    expect(carry(served())).toEqual(STORED);
  });

  it('an element deleted before it: the remaining server keeps ITS OWN password', () => {
    expect(carry(edited({ servers: [{ host: 'b' }] })).config.servers).toEqual([{ host: 'b', password: 'p-b' }]);
  });

  it('a reorder: every value follows its element, a tuple inside a list included', () => {
    const out = carry(
      edited({
        servers: [{ host: 'b' }, { host: 'a' }],
        headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Authorization' }],
        tuples: [['Authorization'], ['Accept', 'json']],
      }),
    );
    expect(out.config).toMatchObject({
      servers: [{ host: 'b', password: 'p-b' }, { host: 'a', password: 'p-a' }],
      headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Authorization', value: 'Bearer h-1' }],
      tuples: [['Authorization', 'Bearer t-1'], ['Accept', 'json']],
    });
  });

  it('a renamed header, an edited sibling field or an edited raw-headers list receives nothing', () => {
    const out = carry(
      edited({
        servers: [{ host: 'a2' }, { host: 'b' }],
        headers: [{ name: 'X-Other' }, { name: 'Accept', value: 'application/json' }],
        tuples: [['Accept', 'json'], ['X-Other']],
        rawHeaders: ['Authorization', null, 'Accept', 'xml'],
      }),
    );
    expect(out.config).toEqual({
      host: 'h',
      servers: [{ host: 'a2' }, { host: 'b', password: 'p-b' }],
      headers: [{ name: 'X-Other' }, { name: 'Accept', value: 'application/json' }],
      tuples: [['Accept', 'json'], ['X-Other']],
      rawHeaders: ['Authorization', null, 'Accept', 'xml'],
    });
    expect(JSON.stringify(out)).not.toMatch(/p-a|h-1|t-1|r-1/);
  });

  it('elements that cannot be told apart receive nothing once the array was edited', () => {
    const stored = {
      name: 'w',
      driver: DRIVER,
      config: { headers: [{ name: 'Authorization', value: 'v-1' }, { name: 'Authorization', value: 'v-2' }, { name: 'Accept', value: 'json' }] },
    };
    const item = structuredClone(redactMetadataItem('datasource', stored));
    expect(carryForwardRedactedValues('datasource', item, stored)).toEqual(stored);
    const trimmed = { ...item, config: { headers: [{ name: 'Authorization' }, { name: 'Authorization' }] } };
    expect(carryForwardRedactedValues('datasource', trimmed, stored)).toEqual(trimmed);
  });

  it('the incoming body is never mutated', () => {
    const incoming = served();
    const before = JSON.stringify(incoming);
    carry(incoming);
    expect(JSON.stringify(incoming)).toBe(before);
  });
});
