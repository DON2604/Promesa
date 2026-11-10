import { type PipeTransform } from '@nestjs/common';
import { type ZodTypeAny, type z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Validates and transforms request input with a shared contracts schema. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}

/** OpenAPI schema generated from the same Zod schema used for validation (no hand-written DTO drift). */
// Narrowed signature: the library's generic overloads exceed TypeScript's instantiation depth.
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: ZodTypeAny,
  options: { target: 'openApi3'; $refStrategy: 'none' },
) => Record<string, unknown>;

export function openApiSchema(schema: ZodTypeAny): Record<string, unknown> {
  const json = toJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  delete json.$schema;
  return json;
}
