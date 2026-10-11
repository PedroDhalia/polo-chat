export type ActionResult<T = undefined> =
  | { ok: true; message?: string; details?: string[]; data?: T }
  | { ok: false; error: string };
