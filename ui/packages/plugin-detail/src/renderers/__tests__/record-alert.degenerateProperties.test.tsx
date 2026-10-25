/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6790 — `record:alert`'s config-bag reader and a DEGENERATE `properties`.
 *
 * The sixth member of the `readProps()` family
 * (`packages/components/src/__tests__/alias-precedence-cross-channel.test.tsx`
 * names it), spelled `{ ...schema, ...schema.properties }` — the node's own
 * keys underneath, no `props` alias leg. objectui#6783 converged the other five
 * on `isConfigBag`; this one kept `?? {}`, which replaces only
 * `null`/`undefined`, so a string or an array went into the object spread and
 * came back out as its own indices.
 *
 * ## BASE_READING — measured on `c4326fe0a`, this branch's base
 *
 * Captured by reverting the guard to `(schema?.properties ?? {})` (leg L1 of
 * the PR's ablation); the failing assertions' received values, verbatim:
 *
 *   readProps({ type: 'record:alert', properties: 'not-a-bag' })
 *     -> indexed keys ["0","1","2","3","4","5","6","7","8"]
 *   readProps({ type: 'record:alert', properties: ['a', 'b'] })
 *     -> indexed keys ["0","1"]
 *
 * beside the node's own `type` and `properties`, which the indices sort AHEAD
 * of whatever the spread order (integer-like keys come first in JS property
 * order). So what the first pins below assert is the ABSENCE of the indices,
 * not the position of `type` and `properties`.
 *
 * ## The discriminating input is the degenerate one
 *
 * A well-formed bag passes on the guarded AND the unguarded reader — it cannot
 * see the defect. So the pins that see it feed a string and an array and assert
 * the indices are NOT among the keys. The well-formed pins are the other axis:
 * the plausible WRONG fix guards too broadly and drops a legitimate bag, so
 * they pin that authored config still reaches every named read (`title`,
 * `body`, `severity`, `action.label`, `dismissible`) — through the real
 * renderer, not the reader alone.
 *
 * ## What the guard does not buy, measured
 *
 * Nothing rendered moves: this renderer reads NAMED keys off the bag and never
 * spreads it onto a DOM element, so a degenerate bag renders exactly as no bag
 * at all — GREEN on the pre-fix tree too, and recorded as such rather than
 * dressed up as a regression pin.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stub = {
  recordCtx: undefined as any,
  metadataItem: undefined as any,
};

// The same DATA-layer doubles `record-alert.test.tsx` uses — record context,
// the metadata fetch behind the CTA, the action dispatch. Everything else,
// `isConfigBag` included, is the shipped module: the factory inherits `actual`.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useRecordContext: () => stub.recordCtx,
    useMetadataItem: (_type: string, _name: string | null) => ({ item: stub.metadataItem }),
    useActionEngine: (_opts: unknown) => ({
      executeAction: vi.fn(async () => ({ success: true })),
      getActionsForLocation: () => [],
      getBulkActions: () => [],
      handleShortcut: async () => null,
      engine: {} as any,
    }),
  };
});

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Alert: ({ children, className, role, ...rest }: any) => (
    <div data-testid="alert" role={role} className={className} {...rest}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: any) => <h5 data-testid="alert-title">{children}</h5>,
  AlertDescription: ({ children }: any) => <div data-testid="alert-body">{children}</div>,
  Button: ({ children, onClick, variant, ...rest }: any) => (
    <button data-testid="alert-cta" data-variant={variant} onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  LazyIcon: ({ name, className }: any) => (
    <svg data-testid="alert-icon" data-name={name} className={className} />
  ),
}));

import { RecordAlertRenderer } from '../record-alert';
import { readProps } from '../record-alert.readProps';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const keysOf = (schema: unknown) => Object.keys(readProps(schema));
const indexKeys = (keys: string[]) => keys.filter((k) => /^\d+$/.test(k));

/** Every named key the renderer reads, authored once, read back three ways below. */
const WELL_FORMED = {
  severity: 'warning' as const,
  title: 'Heads up',
  body: 'Pay attention.',
  action: { actionName: 'resend_verification_email', label: 'Send again' },
  dismissible: true,
};

describe('objectui#6790 — a degenerate `properties` contributes no keys', () => {
  it('a string is not enumerated into its character indices', () => {
    // BASE_READING: indexed keys ["0" … "8"], beside `type` and `properties`.
    const keys = keysOf({ type: 'record:alert', properties: 'not-a-bag' });
    expect(indexKeys(keys)).toEqual([]);
    // The node's own keys are still underneath, and the authored string stays
    // where it was authored — unreinterpreted, not sanitized away.
    expect(keys).toEqual(['type', 'properties']);
  });

  it('an ARRAY is degenerate too — `typeof [] === "object"` is why the predicate has two halves', () => {
    // BASE_READING: indexed keys ["0","1"].
    expect(indexKeys(keysOf({ type: 'record:alert', properties: ['a', 'b'] }))).toEqual([]);
  });

  it('the empty-ish values behave exactly as they did — `??` and the predicate agree here', () => {
    expect(keysOf({})).toEqual([]);
    expect(keysOf({ properties: null })).toEqual(['properties']);
    expect(keysOf({ properties: undefined })).toEqual(['properties']);
    expect(keysOf(undefined)).toEqual([]);
    // A number spreads to nothing even pre-fix; pinned so the fix is not read
    // as having introduced this.
    expect(keysOf({ properties: 42 })).toEqual(['properties']);
  });
});

describe('objectui#6790 — a well-formed `properties` bag still contributes every key (the over-broad-guard axis)', () => {
  it('every authored key reaches the bag, and a nested key still wins the flat legacy spelling', () => {
    const bag = readProps({ type: 'record:alert', title: 'FLAT', properties: WELL_FORMED });
    expect(bag).toMatchObject(WELL_FORMED);
    expect(bag.title).toBe('Heads up');
  });

  it("the flat legacy spelling still resolves on its own — the node's keys underneath are untouched", () => {
    expect(readProps({ type: 'record:alert', title: 'FLAT' }).title).toBe('FLAT');
  });
});

describe('objectui#6790 — the named reads still resolve through the real renderer', () => {
  beforeEach(() => {
    stub.recordCtx = {
      data: { id: 'rec_1', name: 'Acme' },
      objectName: 'sys_user',
      recordId: 'rec_1',
    };
    stub.metadataItem = {
      actions: [
        {
          name: 'resend_verification_email',
          label: 'Resend Verification Email',
          type: 'api',
          target: '/api/v1/auth/send-verification-email',
        },
      ],
    };
  });
  afterEach(cleanup);

  it('title, body, severity, action.label and dismissible all come from the bag', () => {
    render(<RecordAlertRenderer schema={{ properties: WELL_FORMED }} />);
    expect(screen.getByTestId('alert-title').textContent).toBe('Heads up');
    expect(screen.getByTestId('alert-body').textContent).toContain('Pay attention.');
    expect(screen.getByTestId('alert').className).toMatch(/amber/);
    expect(screen.getByTestId('alert-cta').textContent).toBe('Send again');
    expect(screen.getByLabelText('Dismiss')).toBeTruthy();
  });

  it('what the guard does not buy: a degenerate bag renders exactly as no bag at all (GREEN pre-fix too)', () => {
    // Deliberately off-type: the input under test is the one the declaration
    // refuses, which is the whole point — `tsc -p tsconfig.test.json` would
    // otherwise (rightly) reject it as TS2559.
    const degenerate = render(
      <RecordAlertRenderer schema={{ properties: 'not-a-bag' } as any} />
    );
    const degenerateHtml = degenerate.container.innerHTML;
    cleanup();

    const absent = render(<RecordAlertRenderer schema={{}} />);
    expect(degenerateHtml).toBe(absent.container.innerHTML);
  });
});

/**
 * The ratchet objectui#6761 and objectui#6783 each added for their own site:
 * every spelling of this read is an expression that produces no error when it
 * drifts, so the cheap path — copying `?? {}` back, or retelling the predicate
 * inline — has to fail on its own.
 */
describe('objectui#6790 — the reader asks the shared predicate, and the pin that keeps it so', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const reader = readFileSync(path.resolve(here, '../record-alert.readProps.ts'), 'utf8');
  const renderer = readFileSync(path.resolve(here, '../record-alert.tsx'), 'utf8');
  /** Comments out first: the reader's own docblock quotes the spelling it replaced. */
  const stripComments = (s: string) =>
    mask(s);
  /** `schema.properties ?? {}` / `schema?.properties || {}` — the local read objectui#6783 removed. */
  const LOCAL_BAG_READ = /\??\.\s*properties\s*(?:\?\?|\|\|)\s*\{\s*\}/;

  it("the reader imports `isConfigBag` from `@object-ui/react`'s package entry — the one definition, not a retelling", () => {
    expect(reader).toMatch(/import \{ isConfigBag \} from '@object-ui\/react';/);
    // The conjunction objectui#6761's pin scans for, spelled here, would be a
    // copy one package over where that pin cannot see it.
    expect(reader).not.toMatch(/Array\.isArray/);
    expect(stripComments(reader)).not.toMatch(LOCAL_BAG_READ);
  });

  it('the renderer reads its bag through that module and has no `?? {}` read of its own', () => {
    expect(renderer).toMatch(/import \{ readProps \} from '\.\/record-alert\.readProps';/);
    expect(stripComments(renderer)).not.toMatch(LOCAL_BAG_READ);
  });
});
