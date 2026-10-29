import type { DocumentPersistenceCapabilities } from './document-persistence-capabilities';
import type { DocumentIdentityState } from './document-persistence-service';

export type DocumentCapabilityDiagnostics = {
  fileSystemAccessSupported: boolean;
  inPlaceSaveSupported: boolean;
  savePickerSupported: boolean;
  currentDocumentHasWritableBacking: boolean;
};

export function buildDocumentCapabilityDiagnostics(
  capabilities: DocumentPersistenceCapabilities,
  currentDocument: DocumentIdentityState,
): DocumentCapabilityDiagnostics {
  return {
    fileSystemAccessSupported: capabilities.canUseFileSystemAccessApi,
    inPlaceSaveSupported: capabilities.canSaveInPlace,
    savePickerSupported: capabilities.canPromptForSaveLocation,
    currentDocumentHasWritableBacking: currentDocument.hasWritableBacking,
  };
}

export function buildCapabilityIndicatorText(
  capabilities: DocumentPersistenceCapabilities,
  currentDocument: DocumentIdentityState,
): string {
  if (!capabilities.canSaveInPlace) {
    return 'Browser file picker unsupported; saves will download files.';
  }

  if (currentDocument.hasWritableBacking) {
    return 'Editing backed file; Save writes in place.';
  }

  return 'No writable backing; Save routes through Save As.';
}

export function buildOpenTooltip(capabilities: DocumentPersistenceCapabilities): string {
  if (!capabilities.canOpenWithPicker) {
    return 'Opens via file upload import because this browser does not support direct file handles.';
  }
  return 'Open a file from disk and retain a writable backing handle.';
}

export function buildSaveTooltip(
  capabilities: DocumentPersistenceCapabilities,
  currentDocument: DocumentIdentityState,
): string {
  if (currentDocument.hasWritableBacking) {
    return 'Saves changes back to the current file.';
  }
  if (!capabilities.canSaveInPlace) {
    return 'Downloads a saved copy because in-place file save is not supported in this browser.';
  }
  return 'No writable backing file is attached, so Save will run Save As.';
}

export function buildSaveAsTooltip(capabilities: DocumentPersistenceCapabilities): string {
  if (!capabilities.canPromptForSaveLocation) {
    return 'Downloads a copy with this filename; browser chooses final location.';
  }
  return 'Choose a file destination and save a new backing file.';
}

export function buildSaveSuccessMessage(document: DocumentIdentityState): string {
  if (document.lastPersistenceMethod === 'download_fallback') {
    return `Saved download: ${document.displayName}`;
  }
  if (document.lastPersistenceMethod === 'save_in_place') {
    return `Saved in place: ${document.displayName}`;
  }
  if (document.lastPersistenceMethod === 'save_as_picker') {
    return `Saved as: ${document.displayName}`;
  }
  return `Saved: ${document.displayName}`;
}

export function buildOpenSuccessMessage(document: DocumentIdentityState): string {
  if (document.sourceKind === 'file_handle') {
    return `Opened file: ${document.displayName}`;
  }
  if (document.sourceKind === 'imported_file') {
    return `Opened imported file: ${document.displayName} (unbacked)`;
  }
  return `Opened document: ${document.displayName}`;
}
