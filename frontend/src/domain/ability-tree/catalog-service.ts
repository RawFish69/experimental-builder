import { normalizeAbilityTreeDataset } from '@/domain/ability-tree/logic';
import type { AbilityTreeDataRaw, AbilityTreeDataset } from '@/domain/ability-tree/types';

const LATEST_ATREE_VERSION = '2.1.6.0';

function isLikelyVersion(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class AbilityTreeCatalogService {
  private cache = new Map<string, Promise<AbilityTreeDataset>>();

  async getDataset(preferredVersion?: string | null): Promise<AbilityTreeDataset> {
    const versionKey = isLikelyVersion(preferredVersion) ? preferredVersion : LATEST_ATREE_VERSION;
    if (!this.cache.has(versionKey)) {
      this.cache.set(versionKey, this.loadDataset(versionKey));
    }
    return this.cache.get(versionKey)!;
  }

  private async loadDataset(preferredVersion: string): Promise<AbilityTreeDataset> {
    const versionsToTry = unique([preferredVersion, LATEST_ATREE_VERSION]);
    const failures: string[] = [];
    for (const version of versionsToTry) {
      const urls = this.buildUrls(version);
      for (const url of urls) {
        try {
          const response = await fetch(url, { cache: 'force-cache' });
          if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
          }
          const raw = (await response.json()) as AbilityTreeDataRaw;
          return normalizeAbilityTreeDataset(raw, version);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Failed to fetch ${url}`);
        }
      }
    }
    throw new Error(`Unable to load ability tree data. Tried versions: ${versionsToTry.join(', ')}. ${failures.slice(-4).join(' | ')}`);
  }

  private buildUrls(version: string): string[] {
    const resolve = (path: string) => {
      if (typeof window === 'undefined') return path;
      const base = window.location.href.split('?')[0].replace(/\/[^/]*$/, '/') || window.location.origin + '/';
      return new URL(path, base).href;
    };
    return [
      resolve(`data/${version}/atree.json`),
      `./data/${version}/atree.json`,
      `../data/${version}/atree.json`,
      `data/${version}/atree.json`,
    ];
  }
}

export const abilityTreeCatalogService = new AbilityTreeCatalogService();

