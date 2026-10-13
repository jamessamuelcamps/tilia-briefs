import { readFile } from 'node:fs/promises';

/** Reads a file by its path from the repo root. */
export const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Replaces {{name}} placeholders in a prompt template. */
export const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
