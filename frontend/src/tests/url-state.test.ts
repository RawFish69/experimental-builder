import { describe, expect, it } from 'vitest';
import { writeUrlState, parseUrlState } from '@/app/url-state';
import { createInitialWorkbenchSnapshot } from '@/domain/build/workbench-state';

describe('url-state', () => {
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
