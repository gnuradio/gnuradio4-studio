import { useSyncExternalStore } from 'react';
import {
  controlPlaneWasmBinaryUrl,
  getControlPlaneWasmBinarySize,
  getControlPlaneWasmModuleUrl,
  isCrossOriginIsolated,
  subscribeToControlPlaneWasmBinarySize,
} from '../lib/wasm/control-plane-wasm';
import { formatMegabytes } from '../lib/utils/ui-formatting';

// Takes the place of the backend endpoint label when the control plane runs in-process.
// Connection health stays with the status badge next to it; this only identifies the backend.
export function WasmBackendPill({ className = '' }: { className?: string }) {
  const binarySizeBytes = useSyncExternalStore(
    subscribeToControlPlaneWasmBinarySize,
    getControlPlaneWasmBinarySize,
    getControlPlaneWasmBinarySize,
  );

  const moduleUrl = getControlPlaneWasmModuleUrl();
  if (moduleUrl === null) {
    return null;
  }

  const binaryUrl = controlPlaneWasmBinaryUrl(moduleUrl);
  const title = [
    'Control plane: in-process WASM module',
    `Module: ${moduleUrl}`,
    `Binary: ${binaryUrl}${binarySizeBytes === null ? '' : ` (${binarySizeBytes.toLocaleString()} bytes)`}`,
    `Cross-origin isolated: ${isCrossOriginIsolated() ? 'yes' : 'no'}`,
  ].join('\n');

  return (
    <span
      title={title}
      className={`rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 ${className}`}
    >
      {binarySizeBytes === null ? 'WASM' : `WASM: ${formatMegabytes(binarySizeBytes)}`}
    </span>
  );
}
