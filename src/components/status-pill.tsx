import { formatStatus, statusToneClass } from '../lib/utils/ui-formatting';

export function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  const tone = formatStatus(status);
  const text = label ?? (status?.trim() ? status : tone);
  return (
    <span data-runtime-status={tone} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusToneClass(tone)}`}>
      {text}
    </span>
  );
}
