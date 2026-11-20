// Presentation only: values sent to the backend and stored in the document stay canonical.
export function schedulerDisplayName(id?: string): string {
  if (!id) return 'Default scheduler';
  const base = id.split('<')[0];
  const namespaceEnd = base.lastIndexOf('::');
  const name = namespaceEnd < 0 ? base : base.slice(namespaceEnd + 2) || base;
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

export function validTimestamp(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function compactTime(value?: string | null, seconds = false): string {
  return validTimestamp(value)?.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  }) ?? 'Unknown time';
}

export function fullTimestamp(value?: string | null): string {
  return validTimestamp(value)?.toLocaleString() ?? 'Unknown time';
}
