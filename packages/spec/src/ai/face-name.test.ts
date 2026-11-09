// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  AI_FACE_NAME_CUT_LENGTH,
  AI_FACE_NAME_HASH_LENGTH,
  AI_FACE_NAME_MAX_LENGTH,
  AI_FACE_NAME_SEPARATOR,
  deriveAiFaceName,
} from './face-name';

describe('deriveAiFaceName (ADR-0150 D6, ruled Q1 = A)', () => {
  it('spells a package tool, skill, agent or object-less action NS-NAME', () => {
    expect(deriveAiFaceName({ namespace: 'crm', name: 'qualify_lead' })).toBe('crm-qualify_lead');
  });

  it('spells an object-bound action OBJECT-ACTION, never repeating the namespace', () => {
    expect(deriveAiFaceName({ namespace: 'crm', objectName: 'crm_lead', name: 'convert_lead' }))
      .toBe('crm_lead-convert_lead');
    // The object name already carries the identity, so the holder does not change the face.
    expect(deriveAiFaceName({ objectName: 'crm_lead', name: 'convert_lead' })).toBe('crm_lead-convert_lead');
  });

  it('keeps an environment item\'s bare NAME', () => {
    expect(deriveAiFaceName({ name: 'qualify_lead' })).toBe('qualify_lead');
    expect(deriveAiFaceName({ namespace: null, objectName: null, name: 'qualify_lead' })).toBe('qualify_lead');
  });

  it('cuts only past 64 characters', () => {
    const exact = deriveAiFaceName({ namespace: 'crm', name: 'b'.repeat(AI_FACE_NAME_MAX_LENGTH - 4) });
    expect(exact).toHaveLength(AI_FACE_NAME_MAX_LENGTH);
    expect(exact).toBe(`crm-${'b'.repeat(60)}`);
  });

  it('past 64, keeps 55 characters, then `-` and 8 hex of FNV-1a 32 over the whole uncut face', () => {
    const objectName = `crm_${'a'.repeat(51)}`;
    const face = deriveAiFaceName({ objectName, name: 'convert_lead' });
    expect(face).toHaveLength(AI_FACE_NAME_CUT_LENGTH + AI_FACE_NAME_SEPARATOR.length + AI_FACE_NAME_HASH_LENGTH);
    expect(face).toHaveLength(AI_FACE_NAME_MAX_LENGTH);
    expect(face.slice(0, AI_FACE_NAME_CUT_LENGTH)).toBe(`${objectName}-convert_lead`.slice(0, AI_FACE_NAME_CUT_LENGTH));
    // Pinned literally so every server (and the cloud carrier) derives the same
    // name: FNV-1a 32 of `crm_aaa…a-convert_lead` (68 characters). The function
    // matches the published FNV-1a 32 vectors ('' → 811c9dc5, 'a' → e40c292c,
    // 'foobar' → bf9cf968).
    expect(face).toBe(`crm_${'a'.repeat(51)}-c75940c6`);
  });

  it('is deterministic, and two long faces that share their head stay apart', () => {
    const name = 'x'.repeat(70);
    expect(deriveAiFaceName({ namespace: 'crm', name })).toBe(deriveAiFaceName({ namespace: 'crm', name }));
    expect(deriveAiFaceName({ namespace: 'crm', name: `${name}_one` }))
      .not.toBe(deriveAiFaceName({ namespace: 'crm', name: `${name}_two` }));
  });

  it('admits only the provider charset', () => {
    const faces = [
      deriveAiFaceName({ namespace: 'crm', name: 'qualify_lead' }),
      deriveAiFaceName({ objectName: 'crm_lead', name: 'convert_lead' }),
      deriveAiFaceName({ namespace: 'crm', name: 'z'.repeat(90) }),
    ];
    for (const face of faces) expect(face).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});
