import type { DecodedLegacyBuild } from '@/domain/build/types';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import { normalizeHash } from '@/domain/build/legacy-open-link';

export interface LegacyCodecAdapter {
  encodeLegacyHash(buildState: WorkbenchSnapshot): Promise<string>;
  decodeLegacyHash(hashOrUrl: string): Promise<DecodedLegacyBuild>;
  isSupported(hashOrUrl: string): boolean;
}

const LEGACY_SLOT_INPUT_IDS: Array<[keyof DecodedLegacyBuild['slots'], string]> = [
  ['helmet', 'helmet-choice'],
  ['chestplate', 'chestplate-choice'],
  ['leggings', 'leggings-choice'],
  ['boots', 'boots-choice'],
  ['ring1', 'ring1-choice'],
  ['ring2', 'ring2-choice'],
  ['bracelet', 'bracelet-choice'],
  ['necklace', 'necklace-choice'],
  ['weapon', 'weapon-choice'],
];

export function extractLegacyHash(hashOrUrl: string): string | null {
  const trimmed = hashOrUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return normalizeHash(trimmed);
  try {
    const url = new URL(trimmed, window.location.origin);
    return normalizeHash(url.hash);
  } catch {
    return normalizeHash(trimmed);
  }
}

class IframeLegacyCodecAdapter implements LegacyCodecAdapter {
  isSupported(hashOrUrl: string): boolean {
    return extractLegacyHash(hashOrUrl) !== null;
  }

  async encodeLegacyHash(buildState: WorkbenchSnapshot): Promise<string> {
    if (buildState.legacyHash) return buildState.legacyHash;
    throw new Error(
      'Legacy hash encoding is only available for imported legacy builds in Workbench v1. Use Workbench share link or open legacy builder for full encode.',
    );
  }

  async decodeLegacyHash(hashOrUrl: string): Promise<DecodedLegacyBuild> {
    const hash = extractLegacyHash(hashOrUrl);
    if (!hash) {
      throw new Error('No legacy hash found to decode');
    }
    if (typeof document === 'undefined') {
      return { legacyHash: hash, level: null, slots: {} };
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-99999px';
    iframe.style.width = '1200px';
    iframe.style.height = '900px';
    iframe.style.opacity = '0';
    iframe.src = `/builder/#${hash}`;
    document.body.appendChild(iframe);

    const timeoutMs = 30000;
    const started = Date.now();
    try {
      const data = await new Promise<DecodedLegacyBuild>((resolve, reject) => {
        const timer = window.setInterval(() => {
          try {
            if (!iframe.contentDocument) return;
            const doc = iframe.contentDocument;
            const weaponInput = doc.getElementById('weapon-choice') as HTMLInputElement | null;
            const levelInput = doc.getElementById('level-choice') as HTMLInputElement | null;
            if (!weaponInput || !levelInput) {
              if (Date.now() - started > timeoutMs) {
                window.clearInterval(timer);
                reject(new Error('Timed out waiting for legacy builder UI'));
              }
              return;
            }

            const slots: DecodedLegacyBuild['slots'] = {};
            for (const [slotKey, inputId] of LEGACY_SLOT_INPUT_IDS) {
              const input = doc.getElementById(inputId) as HTMLInputElement | null;
              const value = input?.value?.trim();
              if (value) {
                slots[slotKey] = value;
              }
            }

            const weaponValue = slots.weapon;
            // Wait until the hash decode has likely populated at least the weapon or enough inputs.
            if (!weaponValue && Date.now() - started < 2000) return;

            const levelRaw = levelInput.value?.trim();
            const level = levelRaw ? Number(levelRaw) : null;
            window.clearInterval(timer);
            resolve({
              legacyHash: hash,
              level: Number.isFinite(level ?? NaN) ? level : null,
              slots,
              sourceUrl: iframe.src,
            });
          } catch (error) {
            window.clearInterval(timer);
            reject(error);
          }
        }, 250);
      });
      return data;
    } finally {
      iframe.remove();
    }
  }
}

export const legacyCodecAdapter: LegacyCodecAdapter = new IframeLegacyCodecAdapter();

