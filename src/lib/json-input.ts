/**
 * Parse structured JSON supplied inline or from a file/stdin.
 *
 * Complex Linear filters evolve with the GraphQL schema. Keeping them as JSON
 * objects lets the CLI pass the current typed filter shape to @linear/sdk
 * without inventing a lossy mini-language or hard-coding raw GraphQL.
 */

import { readFileSync } from "node:fs";
import { usageError } from "./errors.js";

export interface JsonObjectInput {
  inline?: string;
  file?: string;
  label: string;
}

export function parseJsonObjectInput(input: JsonObjectInput): Record<string, unknown> | undefined {
  if (input.inline !== undefined && input.file !== undefined) {
    throw usageError(`Pass either --${input.label} or --${input.label}-file, not both.`);
  }
  if (input.inline === undefined && input.file === undefined) return undefined;

  let source: string;
  if (input.inline !== undefined) {
    source = input.inline;
  } else {
    const file = input.file!;
    try {
      source = readFileSync(file === "-" ? 0 : file, "utf8");
    } catch (err) {
      throw usageError(`Cannot read ${input.label} file '${file}': ${(err as Error).message}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw usageError(`Invalid JSON for --${input.label}: ${(err as Error).message}`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw usageError(`--${input.label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}
