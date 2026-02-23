/// <reference lib="webworker" />
import type { NormalizedItem } from '@/domain/items/types';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { SearchIndexEngine } from '@/domain/search/search-index';

type SearchWorkerRequest =
  | { type: 'init'; requestId: number; items: NormalizedItem[] }
  | { type: 'search'; requestId: number; state: SearchFilterState };

type SearchWorkerResponse =
  | { type: 'ready'; requestId: number }
  | { type: 'result'; requestId: number; result: SearchResultPage }
  | { type: 'error'; requestId: number; message: string };

let engine: SearchIndexEngine | null = null;

self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      engine = new SearchIndexEngine(msg.items);
      const response: SearchWorkerResponse = { type: 'ready', requestId: msg.requestId };
      self.postMessage(response);
      return;
    }
    if (!engine) {
      throw new Error('Search engine is not initialized');
    }
    const result = engine.search(msg.state);
    const response: SearchWorkerResponse = { type: 'result', requestId: msg.requestId, result };
    self.postMessage(response);
  } catch (error) {
    const response: SearchWorkerResponse = {
      type: 'error',
      requestId: msg.requestId,
      message: error instanceof Error ? error.message : 'Unknown search worker error',
    };
    self.postMessage(response);
  }
};

export type { SearchWorkerRequest, SearchWorkerResponse };

