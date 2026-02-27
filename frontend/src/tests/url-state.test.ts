import { describe, expect, it } from 'vitest';
import { writeUrlState, parseUrlState, parseWorkbenchPatchFromUrl } from '@/app/url-state';
import { createInitialWorkbenchSnapshot } from '@/domain/build/workbench-state';

describe('url-state', () => {
  it('parses legacy base64 URLs (backward compat)', () => {
    const oldFormat = btoa(JSON.stringify({
      slots: { weapon: 456, helmet: 789 },
      locks: { weapon: true },
      level: 106,
      characterClass: 'Warrior',
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = new URL(`/?wb=${oldFormat}`, 'https://example.com');
    const patch = parseWorkbenchPatchFromUrl(url);
    expect(patch?.slots?.weapon).toBe(456);
    expect(patch?.slots?.helmet).toBe(789);
    expect(patch?.locks?.weapon).toBe(true);
    expect(patch?.level).toBe(106);
    expect(patch?.characterClass).toBe('Warrior');
  });

  it('round-trips build state through URL (minimal: no search)', () => {
    window.history.replaceState({}, '', '/');

    const snapshot = createInitialWorkbenchSnapshot();
    snapshot.level = 105;
    snapshot.characterClass = 'Mage';
    snapshot.slots.weapon = 1234;
    snapshot.locks.weapon = true;
    snapshot.legacyHash = 'abc123';

    writeUrlState({
      workbenchSnapshot: snapshot,
      mode: 'autobuilder',
      replace: true,
    });

    const parsed = parseUrlState(window.location);
    expect(parsed.workbenchPatch?.level).toBe(105);
    expect(parsed.workbenchPatch?.characterClass).toBe('Mage');
    expect(parsed.workbenchPatch?.slots?.weapon).toBe(1234);
    expect(parsed.legacyHash).toBe('abc123');
    expect(parsed.mode).toBe('autobuilder');
  });
});
