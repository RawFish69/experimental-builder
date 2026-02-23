import type { CatalogSnapshot } from '@/domain/items/types';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { AutoBuildCandidate, AutoBuildConstraints, AutoBuildProgressEvent } from '@/domain/autobuilder/types';
import type { AutoBuilderWorkerResponse } from '@/domain/autobuilder/worker-runtime';
import { runAutoBuildBeamSearch } from '@/domain/autobuilder/beam-search';

interface AutoBuildRunOptions {
  onProgress?: (progress: AutoBuildProgressEvent) => void;
  signal?: AbortSignal;
}

export class AutoBuilderWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private currentReject: ((reason?: unknown) => void) | null = null;
  private currentRequestId: number | null = null;

  constructor() {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./worker-runtime.ts', import.meta.url), { type: 'module' });
    }
  }

  async run(
    catalog: CatalogSnapshot,
    baseWorkbench: WorkbenchSnapshot,
    constraints: AutoBuildConstraints,
    options: AutoBuildRunOptions = {},
  ): Promise<AutoBuildCandidate[]> {
    if (!this.worker) {
      return runAutoBuildBeamSearch({
        catalog,
        baseWorkbench,
        constraints,
        onProgress: options.onProgress,
        signal: options.signal,
      });
    }

    const requestId = ++this.requestId;
    this.currentRequestId = requestId;

    return new Promise<AutoBuildCandidate[]>((resolve, reject) => {
      this.currentReject = reject;
      const abortListener = () => {
        this.worker?.postMessage({ type: 'cancel', requestId });
        reject(new DOMException('Auto build cancelled', 'AbortError'));
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });

      const onMessage = (event: MessageEvent<AutoBuilderWorkerResponse>) => {
        const msg = event.data;
        if (msg.requestId !== requestId) return;
        if (msg.type === 'progress') {
          options.onProgress?.(msg.progress);
          return;
        }
        this.worker?.removeEventListener('message', onMessage as EventListener);
        options.signal?.removeEventListener('abort', abortListener);
        this.currentReject = null;
        this.currentRequestId = null;
        if (msg.type === 'error') {
          reject(new Error(msg.message));
          return;
        }
        resolve(msg.candidates);
      };

      this.worker!.addEventListener('message', onMessage as EventListener);
      this.worker!.postMessage({
        type: 'run',
        requestId,
        catalog,
        baseWorkbench,
        constraints,
      });
    });
  }

  cancelCurrent(): void {
    if (this.currentRequestId !== null) {
      this.worker?.postMessage({ type: 'cancel', requestId: this.currentRequestId });
      this.currentReject?.(new DOMException('Auto build cancelled', 'AbortError'));
      this.currentReject = null;
      this.currentRequestId = null;
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

