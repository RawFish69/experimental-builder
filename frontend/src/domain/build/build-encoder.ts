import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { CatalogSnapshot } from '@/domain/items/types';
import { ITEM_SLOTS } from '@/domain/items/types';

/**
 * WynnBuilder binary build hash encoder.
 *
 * Produces a URL-fragment string compatible with WynnBuilder's binary format
 * (first B64 char > 11, distinguishing it from legacy encoding).
 *
 * Format mirrors build_encode_decode.js `encodeBuild`:
 *   header(16) + equipment(9 slots) + tomes + skillpoints + level + aspects
 *
 * We only encode normal items (no crafted/custom), no powders, no tomes,
 * automatic skillpoints, and no aspects/ability tree — this covers the
 * common case of sharing item-only builds.
 */

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-';

const VECTOR_FLAG = 0xC;   // 6 bits — forces first char > 11
const VERSION_BITLEN = 10;
const WYNN_VERSION_LATEST = 23; // index for '2.1.6.0'

const EQUIPMENT_KIND_NORMAL = 0;
const EQUIPMENT_KIND_BITLEN = 2;
const ITEM_ID_BITLEN = 13;

// Powderable slot indices (0-3 = armor, 8 = weapon)
const POWDERABLE_INDICES = new Set([0, 1, 2, 3, 8]);

function createBitWriter() {
  const words: number[] = [0];
  let totalBits = 0;

  function append(value: number, count: number) {
    for (let i = 0; i < count; i++) {
      const bit = (value >>> i) & 1;
      const pos = totalBits + i;
      const wordIdx = pos >>> 5;
      while (wordIdx >= words.length) words.push(0);
      if (bit) words[wordIdx] |= 1 << (pos & 31);
    }
    totalBits += count;
  }

  function toB64(): string {
    let result = '';
    for (let i = 0; i < totalBits; i += 6) {
      let val = 0;
      for (let j = 0; j < 6; j++) {
        const pos = i + j;
        if (pos < totalBits) {
          val |= ((words[pos >>> 5] >>> (pos & 31)) & 1) << j;
        }
      }
      result += B64[val];
    }
    return result;
  }

  return { append, toB64, get length() { return totalBits; } };
}

/**
 * Encode the current workbench build into a WynnBuilder-compatible URL hash.
 *
 * Returns the hash string (without leading `#`), or null if no items are equipped.
 */
export function encodeBuildHash(
  snapshot: WorkbenchSnapshot,
  _catalog: CatalogSnapshot,
): string | null {
  const hasAnyItem = ITEM_SLOTS.some((slot) => snapshot.slots[slot] != null);
  if (!hasAnyItem) return null;

  const w = createBitWriter();

  // --- Header ---
  w.append(VECTOR_FLAG, 6);
  w.append(WYNN_VERSION_LATEST, VERSION_BITLEN);

  // --- Equipment (9 slots in ITEM_SLOTS order) ---
  for (let idx = 0; idx < ITEM_SLOTS.length; idx++) {
    const slot = ITEM_SLOTS[idx];
    const itemId = snapshot.slots[slot];

    const craftInfo = snapshot.craftedSlots[slot];
    if (craftInfo?.hash) {
      // Crafted item — inline its hash bits
      const rawHash = craftInfo.hash.startsWith('CR-') ? craftInfo.hash.slice(3) : craftInfo.hash;
      w.append(1, EQUIPMENT_KIND_BITLEN); // CRAFTED = 1
      for (const ch of rawHash) {
        const val = B64.indexOf(ch);
        w.append(val >= 0 ? val : 0, 6);
      }
    } else {
      // Normal item or empty
      w.append(EQUIPMENT_KIND_NORMAL, EQUIPMENT_KIND_BITLEN);
      const encodedId = itemId != null ? itemId + 1 : 0;
      w.append(encodedId, ITEM_ID_BITLEN);
    }

    // Powder flag for powderable slots (NO_POWDERS = 0)
    if (POWDERABLE_INDICES.has(idx)) {
      w.append(0, 1);
    }
  }

  // --- Tomes (NO_TOMES) ---
  w.append(0, 1);

  // --- Skillpoints (AUTOMATIC) ---
  w.append(1, 1);

  // --- Level ---
  const level = snapshot.level ?? 106;
  if (level === 106) {
    w.append(0, 1); // MAX flag
  } else {
    w.append(1, 1); // OTHER flag
    w.append(Math.max(0, Math.min(106, level)), 7);
  }

  // --- Aspects (NO_ASPECTS) ---
  w.append(0, 1);

  // No ability tree bits — decoder handles EOF gracefully.

  return w.toB64();
}

/**
 * Build a full WynnBuilder URL for the given hash.
 */
export function getWynnBuilderBuildUrl(hash: string): string {
  return `https://hppeng-wynn.github.io/builder/#${hash}`;
}
