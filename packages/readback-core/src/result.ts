// Every check returns a Result instead of throwing, so a failure can't be silently skipped.
// `code` is for machines and evals; `message` is the plain-language text a person sees.
export type Failure = { code: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: string, message: string): { ok: false; error: Failure } => ({
  ok: false,
  error: { code, message },
});
