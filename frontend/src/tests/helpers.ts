import { normalizeCatalog } from '@/domain/items/normalize';
import type { RawCompressPayload } from '@/domain/items/types';

export function makeTestCatalog(payloadItems: Array<Record<string, unknown>>) {
  const payload: RawCompressPayload = {
    version: 'test',
    items: payloadItems,
  };
  return normalizeCatalog(payload);
}

export function rawItem(input: Partial<Record<string, unknown>> & { id: number; name: string; type: string; lvl?: number; tier?: string }) {
  return {
    displayName: input.name,
    category: ['spear', 'dagger', 'wand', 'bow', 'relik'].includes(input.type) ? 'weapon' : input.type === 'ring' || input.type === 'bracelet' || input.type === 'necklace' ? 'accessory' : 'armor',
    slots: 0,
    lvl: 1,
    tier: 'Legendary',
    hp: 0,
    hpBonus: 0,
    hprRaw: 0,
    hprPct: 0,
    mr: 0,
    ms: 0,
    ls: 0,
    sdPct: 0,
    sdRaw: 0,
    mdPct: 0,
    mdRaw: 0,
    poison: 0,
    spd: 0,
    atkTier: 0,
    averageDps: 0,
    strReq: 0,
    dexReq: 0,
    intReq: 0,
    defReq: 0,
    agiReq: 0,
    str: 0,
    dex: 0,
    int: 0,
    def: 0,
    agi: 0,
    eDef: 0,
    tDef: 0,
    wDef: 0,
    fDef: 0,
    aDef: 0,
    eDamPct: 0,
    tDamPct: 0,
    wDamPct: 0,
    fDamPct: 0,
    aDamPct: 0,
    damPct: 0,
    rDamPct: 0,
    nDamPct: 0,
    majorIds: [],
    atkSpd: 'NORMAL',
    ...input,
  };
}

