// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5164 — the `_views` bundle key a container's DEFAULT `list` gets from the
// i18n extractor must be the SAME STRING the runtime registry assigns it.
//
// Three surfaces used to derive that key independently and disagree: the
// composer (`expandViewContainer`) named a nameless default list
// `<object>.default`, this extractor wrote `_views.list`, and the lint accepted
// both. An app declaring only a default `list` therefore got a bundle skeleton
// keyed `list`, a runtime view keyed `default`, and an English label on screen
// forever. Maintainer ruling 2026-08-06: canonical = the runtime identity's
// bare key; the extractor converges on the composer.
//
// These tests use the COMPOSER ITSELF as the oracle rather than hard-coding the
// expected spelling, so they pin the invariant ("same key") and not one side's
// current opinion of it. Hard-coded spellings are asserted too, but only where
// the string is the thing under discussion.
import { describe, it, expect } from 'vitest';
import { expandViewContainer } from '@objectstack/spec/ui';
import { collectExpectedEntries } from '../src/utils/i18n-extract';

/** Every `_views` key the extractor scaffolds for `object`, in emit order. */
function extractorViewKeys(object: string, container: any): string[] {
  const prefix = `objects.${object}._views.`;
  const keys: string[] = [];
  for (const entry of collectExpectedEntries({ views: [container] })) {
    const path = entry.path.join('.');
    if (!path.startsWith(prefix) || !path.endsWith('.label')) continue;
    keys.push(path.slice(prefix.length, -'.label'.length));
  }
  return keys;
}

/** Every LIST-family view key the runtime registry assigns for `object`. */
function runtimeListViewKeys(object: string, container: any): string[] {
  return expandViewContainer(object, container)
    .filter((item) => item.viewKind === 'list')
    .map((item) => item.name.slice(`${object}.`.length));
}

const data = { provider: 'object', object: 'task' } as const;

describe('_views keys the extractor scaffolds == the keys the runtime registry assigns (#5164)', () => {
  it('a default-only `list` container is keyed `default`, never `list`', () => {
    // The exact shape measured in the issue body.
    const container = {
      list: { label: 'All Tasks', type: 'grid', data, columns: ['title'] },
    };

    expect(runtimeListViewKeys('task', container)).toEqual(['default']);
    expect(extractorViewKeys('task', container)).toEqual(['default']);

    const paths = collectExpectedEntries({ views: [container] }).map((e) => e.path.join('.'));
    expect(paths).toContain('objects.task._views.default.label');
    expect(paths).not.toContain('objects.task._views.list.label');
  });

  it('carries the default list\'s own label onto the `default` key', () => {
    const container = {
      list: { label: 'All Tasks', type: 'grid', data, columns: ['title'] },
    };
    const byPath = Object.fromEntries(
      collectExpectedEntries({ views: [container] }).map((e) => [e.path.join('.'), e.sourceValue]),
    );
    expect(byPath['objects.task._views.default.label']).toBe('All Tasks');
  });

  it('a default list that STRUCTURALLY restates a `listViews` entry gets no key of its own', () => {
    // The `examples/app-crm` shape: the composer collapses the two by signature,
    // so `crm_*.all` is the only registry entry and a second scaffolded key
    // would be a translation no lookup can reach — the same defect one shape over.
    const view = { label: 'All', type: 'grid', data, columns: ['title'] };
    const container = { list: { ...view }, listViews: { all: { ...view } } };

    expect(runtimeListViewKeys('task', container)).toEqual(['all']);
    expect(extractorViewKeys('task', container)).toEqual(['all']);
  });

  it('a default list carrying an explicit `name` keeps that name on both sides', () => {
    const container = {
      list: { name: 'recent', label: 'Recent', type: 'grid', data, columns: ['title'] },
    };

    expect(runtimeListViewKeys('task', container)).toEqual(['recent']);
    expect(extractorViewKeys('task', container)).toEqual(['recent']);
  });

  it('a default list alongside a distinct `listViews` entry keys both, same set as the registry', () => {
    const container = {
      list: { label: 'All', type: 'grid', data, columns: ['title'] },
      listViews: {
        open: { label: 'Open', type: 'grid', data, columns: ['title', 'status'] },
      },
    };

    expect(runtimeListViewKeys('task', container).sort()).toEqual(['default', 'open']);
    expect(extractorViewKeys('task', container).sort()).toEqual(['default', 'open']);
  });

  it('a `listViews.default` collision renames the default list, and the skeleton follows the rename', () => {
    // The composer keeps the registry key unique (`default` → `default_2`) and
    // stamps a rename warning. The bundle key IS the registry key, so the
    // scaffold has to follow it rather than keep pointing at the taken name.
    const container = {
      list: { label: 'All', type: 'grid', data, columns: ['title'] },
      listViews: {
        default: { label: 'Curated', type: 'grid', data, columns: ['title', 'status'] },
      },
    };

    expect(runtimeListViewKeys('task', container).sort()).toEqual(['default', 'default_2']);
    expect(extractorViewKeys('task', container).sort()).toEqual(['default', 'default_2']);
  });

  it('the container\'s default FORM contributes no `_views` key on either side of the comparison', () => {
    // The extractor deliberately leaves form views out of `_views` (they have
    // no counterpart in the `viewLabel` resolver convention), so there is no
    // sibling `'list'`-style defaulting site to converge for the form face —
    // the composer's `<object>.form` identity is simply not scaffolded.
    const container = {
      list: { label: 'All', type: 'grid', data, columns: ['title'] },
      form: { label: 'Edit', type: 'simple', data, sections: [] },
    };

    expect(runtimeListViewKeys('task', container)).toEqual(['default']);
    expect(extractorViewKeys('task', container)).toEqual(['default']);
    expect(expandViewContainer('task', container).map((i) => i.name)).toContain('task.form');
  });

  it('a container with no default `list` at all scaffolds only its `listViews` keys', () => {
    const container = {
      objectName: 'task',
      listViews: { open: { label: 'Open', type: 'grid', data, columns: ['title'] } },
    };

    expect(extractorViewKeys('task', container)).toEqual(['open']);
  });
});
