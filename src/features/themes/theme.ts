import { z } from 'zod';
import { builtinIds, builtinThemes, DEFAULT_THEME_ID } from './builtins';
import { tokenNames, type ThemeTokens } from './tokens';

export const MAX_THEME_BYTES = 64 * 1024;
const label = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f<>]*$/, 'Use plain text');
const definitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/)
    .refine((id) => !id.startsWith('builtin.'), 'Built-in theme IDs are reserved'),
  name: label,
  author: label.optional(),
  extends: z.enum(builtinIds).default(DEFAULT_THEME_ID),
  tokens: z.object(Object.fromEntries(tokenNames.map((name) => [
    name, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use an opaque six-digit hex color (#RRGGBB)'),
  ]))).partial().strict(),
}).strict();

export type ThemeDefinition = Omit<z.infer<typeof definitionSchema>, 'tokens'> & { tokens: Partial<ThemeTokens> };
export type ResolvedTheme = { id: string; name: string; baseId: string; colorScheme: 'light' | 'dark'; tokens: ThemeTokens };

export function validateTheme(value: unknown): ThemeDefinition {
  const result = definitionSchema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => `${issue.path.join('.') || 'Theme'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

export function parseTheme(text: string): ThemeDefinition {
  if (new TextEncoder().encode(text).byteLength > MAX_THEME_BYTES) throw new Error('Theme exceeds 64 KiB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Theme must contain valid JSON.'); }
  return validateTheme(value);
}

export function resolveTheme(id: string, installed: readonly ThemeDefinition[] = []): ResolvedTheme {
  const builtin = builtinThemes.find((theme) => theme.id === id);
  if (builtin) return { ...builtin, baseId: builtin.id, tokens: { ...builtin.tokens } };
  const raw = installed.find((theme) => theme.id === id);
  if (!raw) throw new Error(`Theme is unavailable: ${id}`);
  const theme = validateTheme(raw);
  const base = builtinThemes.find((candidate) => candidate.id === theme.extends)!;
  return { id: theme.id, name: theme.name, baseId: base.id, colorScheme: base.colorScheme, tokens: { ...base.tokens, ...theme.tokens } };
}

export function exportTheme(theme: ThemeDefinition): string {
  return `${JSON.stringify(validateTheme(theme), null, 2)}\n`;
}
