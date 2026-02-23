import type { NormalizedItem } from '@/domain/items/types';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { SearchIndexEngine } from '@/domain/search/search-index';
import type { SearchWorkerResponse } from '@/domain/search/search-worker';

interface PendingRequest<T> {
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

export class SearchWorkerClient {
  private worker: Worker | null = null;
  private fallbackEngine: SearchIndexEngine | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest<unknown>>();
  private initialized = false;

  constructor() {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
        const msg = event.data;
        const pending = this.pending.get(msg.requestId);
        if (!pending) return;
        this.pending.delete(msg.requestId);
        if (msg.type === 'error') {
          pending.reject(new Error(msg.message));
        } else if (msg.type === 'ready') {
          pending.resolve(undefined);
        } else {
          pending.resolve(msg.result);
        }
      };
      this.worker.onerror = (event) => {
        // Fall back to main-thread search if worker boot fails.
        console.error(event);
        this.worker?.terminate();
        this.worker = null;
      };
    }
  }

  async init(items: NormalizedItem[]): Promise<void> {
    if (this.initialized) return;
    if (this.worker) {
      await this.send<void>({ type: 'init', items } as const);
      this.initialized = true;
      return;
    }
    this.fallbackEngine = new SearchIndexEngine(items);
    this.initialized = true;
  }

  async search(state: SearchFilterState): Promise<SearchResultPage> {
    if (!this.initialized) {
      throw new Error('SearchWorkerClient.init() must be called before search()');
    }
    if (this.worker) {
      return this.send<SearchResultPage>({ type: 'search', state } as const);
    }
    if (!this.fallbackEngine) {
      throw new Error('Fallback search engine unavailable');
    }
    return this.fallbackEngine.search(state);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.fallbackEngine = null;
    this.pending.clear();
  }

  private send<T>(message: Omit<{ requestId: number }, 'requestId'> & Record<string, unknown>): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error('Search worker unavailable'));
    }
    const requestId = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage({ ...message, requestId });
    });
  }
}

