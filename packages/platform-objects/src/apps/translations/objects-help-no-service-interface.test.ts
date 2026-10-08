// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22093 — object field help is product guidance, in every locale.
//
// Studio renders a field's `help` (its source `description`) in the object
// forms. A service-interface name there (`IEmailService.send`) tells an author
// nothing they can act on; where the field is written from belongs in the code
// comment beside the field. The four `objects` bundles are walked whole, so a
// leaf added later with the same shape is caught too, in the locale it lands in.

import { describe, expect, it } from 'vitest';

import { SysEmail } from '../../audit/sys-email.object.js';
import { enObjects } from './en.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';

/** The same shape the notify Template help pin uses (service-automation). */
const SERVICE_INTERFACE = /\bI[A-Z]\w*Service\b/;

const BUNDLES = { en: enObjects, 'es-ES': esESObjects, 'ja-JP': jaJPObjects, 'zh-CN': zhCNObjects };

function stringLeaves(node: unknown, path: string, out: Map<string, string>): Map<string, string> {
  if (typeof node === 'string') out.set(path, node);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) stringLeaves(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

describe('objects bundles: field help names no service interface', () => {
  it('the pattern recognises the interface spelling it exists to keep out', () => {
    expect('Custom headers supplied to IEmailService.send').toMatch(SERVICE_INTERFACE);
  });

  for (const [locale, bundle] of Object.entries(BUNDLES)) {
    it(`${locale}: no string leaf carries a service-interface name`, () => {
      const leaves = stringLeaves(bundle, '', new Map());
      // Positive control: the walk reaches the two leaves this card rewrote.
      expect(leaves.get('sys_email.fields.headers_json.help')).toEqual(expect.any(String));
      expect(leaves.get('sys_email.fields.status.help')).toEqual(expect.any(String));
      const offenders = [...leaves].filter(([, text]) => SERVICE_INTERFACE.test(text)).map(([p]) => p);
      expect(offenders).toEqual([]);
    });
  }

  it('the sys_email source descriptions the en bundle is generated from name none either', () => {
    for (const name of ['headers_json', 'status'] as const) {
      const description = SysEmail.fields[name]?.description;
      expect(description).toEqual(expect.any(String));
      expect(description).not.toMatch(SERVICE_INTERFACE);
    }
  });
});
