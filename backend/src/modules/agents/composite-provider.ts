import type { LLMProvider, LlmTask, StructuredRequest } from './llm-provider';

/**
 * Routes each task to the provider that is actually good and tested for it. Intent compilation
 * stays on the deterministic, span-preserving parser; narration uses the language model when one
 * is configured. `modelTasks` tells the UI which outputs came from a model.
 */
export class CompositeLLMProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly modelTasks: readonly LlmTask[];

  constructor(
    private readonly model_: LLMProvider,
    private readonly deterministic: LLMProvider,
  ) {
    this.name = `${model_.name}+${deterministic.name}`;
    this.model = model_.model;
    this.modelTasks = model_.modelTasks;
  }

  generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    return this.modelTasks.includes(request.task)
      ? this.model_.generateStructured(request)
      : this.deterministic.generateStructured(request);
  }
}
