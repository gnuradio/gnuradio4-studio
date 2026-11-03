import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { builtinThemes } from './builtins';
import { MAX_THEME_BYTES, parseTheme } from './theme';
import { themeManager } from './theme-store';

const button = 'rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700 disabled:opacity-50';

export function ThemeManager() {
  const { active, installed, notice } = useStore(themeManager.store);
  const panel = useRef<HTMLDetailsElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<{ text: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const imported = installed.some((theme) => theme.id === active.id);

  useEffect(() => {
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (panel.current?.open && event.target instanceof Node && !panel.current.contains(event.target)) {
        panel.current.open = false;
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
  }, []);

  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function importText(text: string, replace = false) {
    const definition = await themeManager.import(text, replace);
    setReplacement(null);
    setMessage(`Imported “${definition.name}”. Choose it in the selector to apply it.`);
  }

  return (
    <details ref={panel} className="shrink-0" onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary className={`${button} cursor-pointer list-none`}>Appearance</summary>
      <section aria-label="Appearance" className="fixed right-4 top-28 z-50 max-h-[70vh] w-80 overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100 shadow-xl">
        <h2 className="mb-3 font-semibold">Appearance</h2>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block">
            Theme
            <select aria-label="Theme" value={active.id} onChange={(event) => void run(() => themeManager.select(event.target.value))}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-800 p-2 text-sm text-slate-100">
              <optgroup label="Built-in themes">
                {builtinThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </optgroup>
              {installed.length > 0 && <optgroup label="Imported themes">
                {installed.map((theme) => <option key={theme.id} value={theme.id}>{theme.name} ({theme.id})</option>)}
              </optgroup>}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => fileInput.current?.click()}>Import Theme…</button>
            <button type="button" className={button} disabled={!imported} onClick={() => void run(() => {
              const url = URL.createObjectURL(new Blob([themeManager.export(active.id)], { type: 'application/json' }));
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `${active.id}.gr4stheme`;
              document.body.append(anchor);
              anchor.click();
              anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })}>Export Theme</button>
            <button type="button" className={button} disabled={!imported} onClick={() => void run(async () => {
              await themeManager.delete(active.id);
              setMessage('Imported theme deleted.');
            })}>Delete Theme</button>
          </div>
          <input ref={fileInput} type="file" accept=".gr4stheme" aria-label="Import theme file" className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setReplacement(null);
              void run(async () => {
                if (!/\.gr4stheme$/i.test(file.name)) throw new Error('Choose a .gr4stheme file.');
                if (file.size > MAX_THEME_BYTES) throw new Error('Theme exceeds 64 KiB.');
                const text = await file.text();
                const definition = parseTheme(text);
                if (themeManager.store.getState().installed.some((theme) => theme.id === definition.id)) {
                  setReplacement({ text, name: definition.name });
                  return;
                }
                await importText(text);
              });
            }} />
          {replacement && <div role="alert" className="rounded border border-amber-600 p-2">
            <p>Replace installed theme “{replacement.name}”? This overwrites its saved definition.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={button} onClick={() => void run(() => importText(replacement.text, true))}>Replace Theme</button>
              <button type="button" className={button} onClick={() => setReplacement(null)}>Cancel</button>
            </div>
          </div>}
        </fieldset>
        {error && <p role="alert" className="mt-3 break-words text-rose-300">{error}</p>}
        {message && <p role="status" className="mt-3 text-slate-300">{message}</p>}
        {notice && <p className="mt-3 text-amber-300">{notice}</p>}
        <p className="mt-3 text-xs text-slate-400">Themes and preferences are saved {window.gr4StudioShell?.themes ? 'in your Studio user configuration' : 'in this browser profile'}. Built-in themes cannot be deleted.</p>
      </section>
    </details>
  );
}
