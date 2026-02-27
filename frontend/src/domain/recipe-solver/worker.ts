import type {
  RecipeCatalogSnapshot,
  RecipeSolverConstraints,
  RecipeSolverCandidate,
  RecipeSolverProgressEvent,
} from '@/domain/recipe-solver/types';
import type { RecipeSolverWorkerResponse } from '@/domain/recipe-solver/worker-runtime';
import { runRecipeSolverBeamSearch } from '@/domain/recipe-solver/beam-search';

interface RecipeSolverRunOptions {
  onProgress?: (progress: RecipeSolverProgressEvent) => void;
  signal?: AbortSignal;
}

export class RecipeSolverWorkerClient {
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
    catalog: RecipeCatalogSnapshot,
    constraints: RecipeSolverConstraints,
    options: RecipeSolverRunOptions = {},
  ): Promise<RecipeSolverCandidate[]> {
    if (!this.worker) {
      return runRecipeSolverBeamSearch({
        catalog,
        constraints,
        onProgress: options.onProgress,
        signal: options.signal,
      });
    }

    const requestId = ++this.requestId;
    this.currentRequestId = requestId;

    return new Promise<RecipeSolverCandidate[]>((resolve, reject) => {
      this.currentReject = reject;
      const abortListener = () => {
        this.worker?.postMessage({ type: 'cancel', requestId });
        reject(new DOMException('Recipe solver cancelled', 'AbortError'));
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });

      const onMessage = (event: MessageEvent<RecipeSolverWorkerResponse>) => {
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
        constraints,
      });
    });
  }

  cancelCurrent(): void {
    if (this.currentRequestId !== null) {
      this.worker?.postMessage({ type: 'cancel', requestId: this.currentRequestId });
      this.currentReject?.(new DOMException('Recipe solver cancelled', 'AbortError'));
      this.currentReject = null;
      this.currentRequestId = null;
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
