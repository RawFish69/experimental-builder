import { normalizeCatalog } from '@/domain/items/normalize';
import type { CatalogSnapshot, RawCompressPayload } from '@/domain/items/types';

export class ItemCatalogService {
  private snapshotPromise: Promise<CatalogSnapshot> | null = null;

  async getCatalog(): Promise<CatalogSnapshot> {
    if (!this.snapshotPromise) {
      this.snapshotPromise = this.loadCatalog();
    }
    return this.snapshotPromise;
  }

  async getItemById(id: number): Promise<CatalogSnapshot['items'][number] | undefined> {
    const catalog = await this.getCatalog();
    return catalog.itemsById.get(id);
  }

  private async loadCatalog(): Promise<CatalogSnapshot> {
    const payload = await this.fetchCompressPayload();
    return normalizeCatalog(payload);
  }

  private async fetchCompressPayload(): Promise<RawCompressPayload> {
    const resolve = (path: string) => {
      if (typeof window === 'undefined') return path;
      const base = window.location.href.split('?')[0].replace(/\/[^/]*$/, '/') || window.location.origin + '/';
      return new URL(path, base).href;
    };
    const urls = [resolve('compress.json'), resolve('./compress.json'), './compress.json', '../compress.json', 'compress.json'];
    let lastError: unknown = null;
    const failures: string[] = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }
        const json = (await response.json()) as RawCompressPayload;
        if (!json?.items || !Array.isArray(json.items)) {
          throw new Error(`Invalid compress payload from ${url}`);
        }
        return json;
      } catch (error) {
        lastError = error;
        failures.push(error instanceof Error ? error.message : `Failed to fetch ${url}`);
      }
    }
    if (lastError instanceof Error) {
      throw new Error(`Unable to load compress.json. Tried: ${urls.join(', ')}. Last error: ${lastError.message}`);
    }
    throw new Error(`Unable to load compress.json. Tried: ${urls.join(', ')}. Failures: ${failures.join(' | ')}`);
  }
}

export const itemCatalogService = new ItemCatalogService();
