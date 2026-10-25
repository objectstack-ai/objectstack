import { describe, it, expect } from 'vitest';
import { __testables } from './ImportWizard';

const { autoMapColumns } = __testables;

/**
 * Moved here from `importTemplate.test.ts` when the client-built CSV template
 * was deleted (objectui#9600). The mapping half of that file tests live code:
 * the template is now the server's, and the server still heads a required
 * column with its label plus ` *`. A filled-in template has to map back.
 */
describe('autoMapColumns', () => {
  const fields = [
    { name: 'name', label: '客户名称', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email' },
  ];

  it('maps a filled-in import template back to its fields: the ` *` required marker does not defeat matching', () => {
    expect(autoMapColumns(['客户名称 *', 'Email'], fields)).toEqual({ 0: 'name', 1: 'email' });
  });

  it('maps the same headers without the marker identically (control)', () => {
    expect(autoMapColumns(['客户名称', 'Email'], fields)).toEqual({ 0: 'name', 1: 'email' });
  });
});
