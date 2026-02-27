/// <reference lib="webworker" />
import type {
  RecipeCatalogSnapshot,
  RecipeSolverConstraints,
  RecipeSolverCandidate,
  RecipeSolverProgressEvent,
  NormalizedRecipe,
  NormalizedIngredient,
} from '@/domain/recipe-solver/types';
import { runRecipeSolverBeamSearch } from '@/domain/recipe-solver/beam-search';

export type RecipeSolverWorkerRequest =
  | {
      type: 'run';
      requestId: number;
      catalog: RecipeCatalogSnapshot;
      constraints: RecipeSolverConstraints;
    }
  | { type: 'cancel'; requestId: number };

export type RecipeSolverWorkerResponse =
  | { type: 'progress'; requestId: number; progress: RecipeSolverProgressEvent }
  | { type: 'result'; requestId: number; candidates: RecipeSolverCandidate[] }
  | { type: 'error'; requestId: number; message: string };

const controllers = new Map<number, AbortController>();

function rehydrateCatalog(raw: RecipeCatalogSnapshot): RecipeCatalogSnapshot {
  return {
    ...raw,
    recipesById: new Map<number, NormalizedRecipe>(raw.recipesById),
    recipesByType: new Map<string, NormalizedRecipe[]>(raw.recipesByType),
    ingredientsById: new Map<number, NormalizedIngredient>(raw.ingredientsById),
    ingredientsBySkill: new Map<string, NormalizedIngredient[]>(raw.ingredientsBySkill),
    ingredientIdByName: new Map<string, number>(raw.ingredientIdByName),
  };
}

self.onmessage = (event: MessageEvent<RecipeSolverWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    controllers.get(msg.requestId)?.abort();
    return;
  }

  const controller = new AbortController();
  controllers.set(msg.requestId, controller);

  try {
    const catalog = rehydrateCatalog(msg.catalog);
    const candidates = runRecipeSolverBeamSearch({
      catalog,
      constraints: msg.constraints,
      signal: controller.signal,
      onProgress: (progress) => {
        const response: RecipeSolverWorkerResponse = {
          type: 'progress',
          requestId: msg.requestId,
          progress,
        };
        self.postMessage(response);
      },
    });
    const response: RecipeSolverWorkerResponse = {
      type: 'result',
      requestId: msg.requestId,
      candidates,
    };
    self.postMessage(response);
  } catch (error) {
    const response: RecipeSolverWorkerResponse = {
      type: 'error',
      requestId: msg.requestId,
      message: error instanceof Error ? error.message : 'Recipe solver worker error',
    };
    self.postMessage(response);
  } finally {
    controllers.delete(msg.requestId);
  }
};
