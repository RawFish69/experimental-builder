import { describe, expect, it } from 'vitest';
import { extractLegacyHash, legacyCodecAdapter } from '@/domain/build/legacy-codec-adapter';

describe('legacy-codec-adapter', () => {
  it('extracts legacy hash from hash-only input and builder URLs', () => {
    expect(extractLegacyHash('#abc123')).toBe('abc123');
    expect(extractLegacyHash('/builder/#xyz987')).toBe('xyz987');
    expect(extractLegacyHash('https://example.com/builder/#HELLO')).toBe('HELLO');
  });

  it('reports support for hash-like inputs', () => {
    expect(legacyCodecAdapter.isSupported('#foo')).toBe(true);
    expect(legacyCodecAdapter.isSupported('https://example.com/builder/#foo')).toBe(true);
    expect(legacyCodecAdapter.isSupported('')).toBe(false);
  });
});

