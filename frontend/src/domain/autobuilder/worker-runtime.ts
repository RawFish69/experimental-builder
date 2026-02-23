/// <reference lib="webworker" />
import type { CatalogSnapshot } from '@/domain/items/types';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { AutoBuildConstraints, AutoBuildProgressEvent, AutoBuildCandidate } from '@/domain/autobuilder/types';
import { runAutoBuildBeamSearch } from '@/domain/autobuilder/beam-search';

type WorkerRequest =
  | {
      type: 'run';
      requestId: number;
      catalog: CatalogSnapshot;
      baseWorkbench: WorkbenchSnapshot;
      constraints: AutoBuildConstraints;
    }
  | { type: 'cancel'; requestId: number };

type WorkerResponse =
  | { type: 'progress'; requestId: number; progress: AutoBuildProgressEvent }
  | { type: 'result'; requestId: number; candidates: AutoBuildCandidate[] }
  | { type: 'error'; requestId: number; message: string };

const controllers = new Map<number, AbortController>();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    controllers.get(msg.requestId)?.abort();
    return;
  }

  const controller = new AbortController();
  controllers.set(msg.requestId, controller);

  try {
    const candidates = runAutoBuildBeamSearch({
      catalog: {
        ...msg.catalog,
        itemsById: new Map(msg.catalog.itemsById),
        itemIdByName: new Map(msg.catalog.itemIdByName),
        itemsByType: new Map(msg.catalog.itemsByType),
        itemsByCategory: new Map(msg.catalog.itemsByCategory),
      },
      baseWorkbench: msg.baseWorkbench,
      constraints: msg.constraints,
      signal: controller.signal,
      onProgress: (progress) => {
        const response: WorkerResponse = { type: 'progress', requestId: msg.requestId, progress };
        self.postMessage(response);
      },
    });
    const response: WorkerResponse = { type: 'result', requestId: msg.requestId, candidates };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId: msg.requestId,
      message: error instanceof Error ? error.message : 'Auto builder worker error',
    };
    self.postMessage(response);
  } finally {
    controllers.delete(msg.requestId);
  }
};

export type { WorkerRequest as AutoBuilderWorkerRequest, WorkerResponse as AutoBuilderWorkerResponse };

