import type { ErrorRequestHandler } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Record") => new HttpError(404, `${what} not found`);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    throw new HttpError(400, field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid input"));
  }
  return result.data;
}

export function idParam(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

/** Postgres unique violations become a readable 409. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const code = err?.code ?? err?.cause?.code;
  if (code === "23505") {
    res.status(409).json({ error: "That name or email is already in use" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
};
