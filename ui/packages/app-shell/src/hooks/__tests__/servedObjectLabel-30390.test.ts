/**
 * objectstack#30390 — the served-object-label rule both helpers apply: a label
 * the server served is already translated, so it is drawn as given; the
 * bundle lookup runs only when none is served, with the caller's client
 * fallback (an object's name, say) as the bundle's own last resort.
 *
 * The lookups are stand-ins for `useObjectLabel()`'s, answering with the
 * bundle's packaged string, so every case says which side won.
 */
import { describe, expect, it } from 'vitest';
import { servedObjectLabel, servedObjectPluralLabel } from '../useNavTargetLabel';

/** The base package's catalog entry, as the bundle would answer it. */
const objectLabel = ({ name, label }: { name: string; label: string }) =>
  name === 'showcase_project' ? '项目' : label;
const objectPluralLabel = ({ name, label }: { name: string; label: string; pluralLabel?: string }) =>
  name === 'showcase_project' ? '项目清单' : label;

describe('servedObjectLabel (objectstack#30390)', () => {
  it('draws a served label as given, over the packaged translation', () => {
    expect(servedObjectLabel({ name: 'showcase_project', label: '风险投资' }, 'zh-CN', objectLabel)).toBe('风险投资');
  });

  it('reads an inline locale map in the active language', () => {
    const label = { en: 'Venture', 'zh-CN': '风险投资' };
    expect(servedObjectLabel({ name: 'showcase_project', label }, 'zh-CN', objectLabel)).toBe('风险投资');
  });

  it('asks the bundle only when no label is served', () => {
    expect(servedObjectLabel({ name: 'showcase_project' }, 'zh-CN', objectLabel)).toBe('项目');
    expect(servedObjectLabel({ name: 'showcase_project', label: '  ' }, 'zh-CN', objectLabel)).toBe('项目');
  });

  it('hands the caller fallback to the bundle as its last resort, never ahead of it', () => {
    expect(servedObjectLabel({ name: 'crm_lead' }, 'zh-CN', objectLabel, 'crm_lead')).toBe('crm_lead');
    expect(servedObjectLabel({ name: 'crm_lead' }, 'zh-CN', objectLabel)).toBe('');
    expect(servedObjectLabel({ name: 'showcase_project' }, 'zh-CN', objectLabel, 'showcase_project')).toBe('项目');
  });
});

describe('servedObjectPluralLabel fallback (objectstack#30390)', () => {
  it('keeps the served plural, then the served label, ahead of the bundle', () => {
    const def = { name: 'showcase_project', label: '风险投资', pluralLabel: '风险投资清单' };
    expect(servedObjectPluralLabel(def, 'zh-CN', objectPluralLabel, 'showcase_project')).toBe('风险投资清单');
    expect(servedObjectPluralLabel({ ...def, pluralLabel: undefined }, 'zh-CN', objectPluralLabel)).toBe('风险投资');
  });

  it('hands the caller fallback to the bundle when nothing is served', () => {
    expect(servedObjectPluralLabel({ name: 'crm_lead' }, 'zh-CN', objectPluralLabel, 'crm_lead')).toBe('crm_lead');
    expect(servedObjectPluralLabel({ name: 'showcase_project' }, 'zh-CN', objectPluralLabel, 'x')).toBe('项目清单');
  });
});
