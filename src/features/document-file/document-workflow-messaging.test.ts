import { describe, expect, it } from 'vitest';
import {
  buildCapabilityIndicatorText,
  buildDocumentCapabilityDiagnostics,
  buildOpenTooltip,
  buildSaveAsTooltip,
  buildSaveSuccessMessage,
  buildSaveTooltip,
  type DocumentCapabilityDiagnostics,
} from './document-workflow-messaging';
import type { DocumentPersistenceCapabilities } from './document-persistence-capabilities';
import type { DocumentIdentityState } from './document-persistence-service';

function capabilities(overrides: Partial<DocumentPersistenceCapabilities> = {}): DocumentPersistenceCapabilities {
  return {
    canUseFileSystemAccessApi: false,
    canSaveInPlace: false,
    canPromptForSaveLocation: false,
    usesDownloadFallback: true,
    canOpenWithPicker: false,
    ...overrides,
  };
}

function document(overrides: Partial<DocumentIdentityState> = {}): DocumentIdentityState {
  return {
    internalDocumentId: 'document-1',
    displayName: 'example_flowgraph.gr4s',
    documentFormat: 'gr4-studio.graph@1',
    sourceKind: 'imported_file',
    fileHandle: null,
    filePathHint: 'example_flowgraph.gr4s',
    hasWritableBacking: false,
    isDirty: true,
    isUntitled: false,
    lastSavedAt: null,
    lastLoadedAt: null,
    lastPersistenceMethod: null,
    lastPersistedContentHash: null,
    ...overrides,
  };
}

describe('document workflow messaging', () => {
  it('reports capability summary correctly for unsupported browser', () => {
    const summary: DocumentCapabilityDiagnostics = buildDocumentCapabilityDiagnostics(
      capabilities(),
      document(),
    );
    expect(summary.fileSystemAccessSupported).toBe(false);
    expect(summary.inPlaceSaveSupported).toBe(false);
    expect(summary.savePickerSupported).toBe(false);
    expect(summary.currentDocumentHasWritableBacking).toBe(false);
  });

  it('reports capability summary correctly for supported browser with backed document', () => {
    const summary = buildDocumentCapabilityDiagnostics(
      capabilities({
        canUseFileSystemAccessApi: true,
        canSaveInPlace: true,
        canPromptForSaveLocation: true,
        canOpenWithPicker: true,
        usesDownloadFallback: false,
      }),
      document({
        sourceKind: 'file_handle',
        hasWritableBacking: true,
      }),
    );
    expect(summary.fileSystemAccessSupported).toBe(true);
    expect(summary.inPlaceSaveSupported).toBe(true);
    expect(summary.savePickerSupported).toBe(true);
    expect(summary.currentDocumentHasWritableBacking).toBe(true);
  });

  it('builds truthful Save/Save As tooltip copy for fallback and backed modes', () => {
    expect(
      buildSaveTooltip(capabilities(), document({ hasWritableBacking: false })),
    ).toContain('Downloads a saved copy');

    expect(
      buildSaveAsTooltip(capabilities()),
    ).toContain('Downloads a copy');

    expect(
      buildSaveTooltip(
        capabilities({
          canUseFileSystemAccessApi: true,
          canSaveInPlace: true,
          canPromptForSaveLocation: true,
          canOpenWithPicker: true,
          usesDownloadFallback: false,
        }),
        document({ sourceKind: 'file_handle', hasWritableBacking: true }),
      ),
    ).toContain('Saves changes back to the current file');
  });

  it('builds truthful capability indicator and open tooltip', () => {
    expect(buildCapabilityIndicatorText(capabilities(), document())).toContain('saves will download files');
    expect(buildOpenTooltip(capabilities())).toContain('upload import');
  });

  it('builds fallback save success wording without implying selected destination', () => {
    const message = buildSaveSuccessMessage(
      document({
        lastPersistenceMethod: 'download_fallback',
      }),
    );
    expect(message).toBe('Saved download: example_flowgraph.gr4s');
  });
});
