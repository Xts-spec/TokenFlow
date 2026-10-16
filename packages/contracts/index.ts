import { z } from 'zod';

export const runnerErrorResponseSchema = z.object({
  code: z.string().min(1),
  error: z.string().min(1),
  hint: z.string().min(1).optional(),
});
export type RunnerErrorResponse = z.infer<typeof runnerErrorResponseSchema>;
