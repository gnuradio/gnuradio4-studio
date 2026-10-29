import { editorGraphFromDocument } from '../graph-document/model/toEditor';
import type { EditorSnapshot } from '../graph-tabs/store/graphTabsStore';
import {
  deserializeDocumentText,
  serializeEditorSnapshot,
  STUDIO_UNTITLED_NAME,
  type SerializedStudioDocument,
} from './document-serialization';
import type { DocumentPersistenceCapabilities } from './document-persistence-capabilities';
import type { RecentDocument } from './recent-documents';

const ACCEPT_TYPES = [
  {
    description: 'gr4-studio graph document',
    accept: {
      'application/json': ['.gr4s'],
    },
  },
];

type FileSystemWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle>;
};

type FileHandlePermissionDescriptor = {
  mode?: 'read' | 'readwrite';
};

export type PersistenceResultKind = 'success' | 'canceled' | 'failed_validation' | 'failed_io' | 'unsupported';
export type SourceKind = 'untitled' | 'file_handle' | 'imported_file' | 'downloaded_export' | 'remote_document';
export type PersistenceMethod = 'save_in_place' | 'save_as_picker' | 'download_fallback' | 'import_only';

export type DocumentIdentityState = {
  internalDocumentId: string;
  displayName: string;
  documentFormat: string;
  sourceKind: SourceKind;
  fileHandle: FileSystemFileHandle | null;
  nativeFileToken?: string;
  fileFingerprint?: string;
  filePathHint: string | null;
  hasWritableBacking: boolean;
  isDirty: boolean;
  isUntitled: boolean;
  lastSavedAt: string | null;
  lastLoadedAt: string | null;
  lastPersistenceMethod: PersistenceMethod | null;
  lastPersistedContentHash: string | null;
};

type PersistenceSuccess<T extends object = object> = {
  kind: 'success';
  value: T;
};

type PersistenceFailure = {
  kind: Exclude<PersistenceResultKind, 'success'>;
  message: string;
  reason?: 'permission_revoked' | 'parse_error' | 'io_error' | 'unsupported_format';
};

export type PersistenceResult<T extends object = object> = PersistenceSuccess<T> | PersistenceFailure;

type OpenDocumentSuccess = {
  replacement: EditorSnapshot;
  documentIdentity: DocumentIdentityState;
};

type SaveDocumentSuccess = {
  documentIdentity: DocumentIdentityState;
  serialized: SerializedStudioDocument;
};

type ServiceDeps = {
  win?: Window;
  now?: () => string;
  nextDocumentId?: () => string;
};

function nowIso(): string {
  return new Date().toISOString();
}

let inMemoryDocCounter = 0;

function createDocumentId(): string {
  inMemoryDocCounter += 1;
  return `document-${inMemoryDocCounter}`;
}

function sanitizeDisplayName(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return STUDIO_UNTITLED_NAME;
  }
  return value.trim();
}

function sanitizeFileNameSuggestion(value: string): string {
  const trimmed = sanitizeDisplayName(value);
  const cleaned = trimmed
    // Avoid path-like names and control chars that can break picker/download behavior.
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/g, '');
  const bounded = cleaned.slice(0, 120).trim();
  return bounded || STUDIO_UNTITLED_NAME;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function toSaveIoErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Browser blocked save access. Retry from a direct click on Save/Save As.';
    }
    if (error.name === 'TypeError') {
      return 'Invalid save filename. Rename the document and retry Save As.';
    }
  }
  if (error instanceof TypeError) {
    return 'Invalid save filename or save options. Rename the document and retry Save As.';
  }
  if (error instanceof Error && error.message.trim()) {
    return `Failed to save: ${error.message.trim()}`;
  }
  return 'Failed to save due to browser/API error.';
}

class PermissionRevokedError extends Error {
  constructor() {
    super('File no longer writable or permission revoked.');
  }
}

async function ensureWritePermission(fileHandle: FileSystemFileHandle): Promise<void> {
  const queryPermission = (fileHandle as FileSystemHandle & {
    queryPermission?: (descriptor?: FileHandlePermissionDescriptor) => Promise<PermissionState>;
  }).queryPermission;
  const requestPermission = (fileHandle as FileSystemHandle & {
    requestPermission?: (descriptor?: FileHandlePermissionDescriptor) => Promise<PermissionState>;
  }).requestPermission;
  const descriptor: FileHandlePermissionDescriptor = { mode: 'readwrite' };

  if (typeof queryPermission === 'function') {
    try {
      const state = await queryPermission.call(fileHandle, descriptor);
      if (state === 'denied') {
        throw new PermissionRevokedError();
      }
      if (state === 'granted') {
        return;
      }
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      // Some browser implementations reject permission descriptors; fall through to createWritable.
    }
  }

  if (typeof requestPermission === 'function') {
    try {
      const state = await requestPermission.call(fileHandle, descriptor);
      if (state !== 'granted') {
        throw new PermissionRevokedError();
      }
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      // If requestPermission signature/descriptor is unsupported, allow createWritable to decide.
    }
  }
}

async function writeFileHandle(fileHandle: FileSystemFileHandle, content: string): Promise<void> {
  await ensureWritePermission(fileHandle);
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function triggerDownload(win: Window, fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = win.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickUploadedFile(win: Window): Promise<File | null> {
  return new Promise((resolve) => {
    const input = win.document.createElement('input');
    input.type = 'file';
    input.accept = '.gr4s,application/json';
    const finalize = (file: File | null) => {
      input.onchange = null;
      input.oncancel = null;
      resolve(file);
    };
    input.onchange = () => {
      finalize(input.files?.[0] ?? null);
    };
    input.oncancel = () => {
      finalize(null);
    };
    input.click();
  });
}

export function createUntitledDocumentIdentity(capabilities: DocumentPersistenceCapabilities): DocumentIdentityState {
  void capabilities;
  return {
    internalDocumentId: createDocumentId(),
    displayName: STUDIO_UNTITLED_NAME,
    documentFormat: 'gr4-studio.graph@1',
    sourceKind: 'untitled',
    fileHandle: null,
    filePathHint: null,
    hasWritableBacking: false,
    isDirty: false,
    isUntitled: true,
    lastSavedAt: null,
    lastLoadedAt: null,
    lastPersistenceMethod: null,
    lastPersistedContentHash: null,
  };
}

export function createDocumentPersistenceService(deps: ServiceDeps = {}) {
  const win = deps.win ?? window;
  const typedWindow = win as FileSystemWindow;
  const nativeFiles = win.gr4StudioShell?.capabilities?.nativeFiles ? win.gr4StudioShell.documents : undefined;
  const now = deps.now ?? nowIso;
  const nextDocumentId = deps.nextDocumentId ?? createDocumentId;

  const openDocument = async (
    capabilities: DocumentPersistenceCapabilities,
    recent?: RecentDocument,
  ): Promise<PersistenceResult<OpenDocumentSuccess>> => {
    void capabilities;
    try {
      if (nativeFiles) {
        const file = recent ? await nativeFiles.openRecent({ id: recent.id }) : await nativeFiles.open();
        if (!file) return { kind: 'canceled', message: 'Open canceled.' };
        const serialized = deserializeDocumentText(file.content);
        return { kind: 'success', value: {
          replacement: editorGraphFromDocument(serialized.document),
          documentIdentity: {
            ...createUntitledDocumentIdentity(capabilities),
            internalDocumentId: nextDocumentId(),
            displayName: file.name,
            documentFormat: serialized.documentFormat,
            sourceKind: 'file_handle',
            nativeFileToken: file.token,
            filePathHint: file.name,
            hasWritableBacking: true,
            isUntitled: false,
            lastLoadedAt: now(),
            lastPersistenceMethod: 'import_only',
            lastPersistedContentHash: serialized.contentHash,
          },
        } };
      }
      if (recent?.fileHandle || typeof typedWindow.showOpenFilePicker === 'function') {
        const handle = recent?.fileHandle ?? (await typedWindow.showOpenFilePicker!({
          multiple: false,
          excludeAcceptAllOption: false,
          types: ACCEPT_TYPES,
        }))[0];

        if (!handle) {
          return {
            kind: 'canceled',
            message: 'Open canceled.',
          };
        }

        if (recent?.fileHandle) {
          const permissionHandle = handle as FileSystemFileHandle & {
            requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
          };
          // Called from the recent-file button before an IndexedDB read can consume user activation.
          if (permissionHandle.requestPermission && await permissionHandle.requestPermission({ mode: 'read' }) !== 'granted') {
            return { kind: 'failed_io', message: 'Access to this file was not granted. Try again or select the file again.', reason: 'permission_revoked' };
          }
        }
        const file = await handle.getFile();
        const serialized = deserializeDocumentText(await file.text());
        return {
          kind: 'success',
          value: {
            replacement: editorGraphFromDocument(serialized.document),
            documentIdentity: {
              internalDocumentId: nextDocumentId(),
              displayName: sanitizeDisplayName(file.name),
              documentFormat: serialized.documentFormat,
              sourceKind: 'file_handle',
              fileHandle: handle,
              filePathHint: file.name,
              hasWritableBacking: true,
              isDirty: false,
              isUntitled: false,
              lastSavedAt: null,
              lastLoadedAt: now(),
              lastPersistenceMethod: 'import_only',
              lastPersistedContentHash: serialized.contentHash,
            },
          },
        };
      }

      const uploadedFile = await pickUploadedFile(win);
      if (!uploadedFile) {
        return {
          kind: 'canceled',
          message: 'Open canceled.',
        };
      }

      const serialized = deserializeDocumentText(await uploadedFile.text());
      return {
        kind: 'success',
        value: {
          replacement: editorGraphFromDocument(serialized.document),
          documentIdentity: {
            internalDocumentId: nextDocumentId(),
            displayName: sanitizeDisplayName(uploadedFile.name),
            documentFormat: serialized.documentFormat,
            sourceKind: 'imported_file',
            fileHandle: null,
            fileFingerprint: JSON.stringify([uploadedFile.name, uploadedFile.size, uploadedFile.lastModified]),
            filePathHint: uploadedFile.name,
            hasWritableBacking: false,
            isDirty: false,
            isUntitled: false,
            lastSavedAt: null,
            lastLoadedAt: now(),
            lastPersistenceMethod: 'import_only',
            lastPersistedContentHash: serialized.contentHash,
          },
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          kind: 'canceled',
          message: 'Open canceled.',
        };
      }

      if (error instanceof Error) {
        const lower = error.message.toLowerCase();
        return {
          kind: 'failed_validation',
          message: error.message,
          reason: lower.includes('unsupported graph document format') || lower.includes('unsupported graph document version')
            ? 'unsupported_format'
            : 'parse_error',
        };
      }

      return {
        kind: 'failed_io',
        message: 'Failed to parse/open file.',
        reason: 'io_error',
      };
    }
  };

  const saveCurrentDocumentAs = async (
    documentIdentity: DocumentIdentityState,
    snapshot: EditorSnapshot,
    capabilities: DocumentPersistenceCapabilities,
  ): Promise<PersistenceResult<SaveDocumentSuccess>> => {
    void capabilities;
    const serialized = serializeEditorSnapshot(snapshot);
    const suggestedName = sanitizeFileNameSuggestion(documentIdentity.displayName || STUDIO_UNTITLED_NAME);
    const saveTime = now();

    try {
      if (nativeFiles) {
        const file = await nativeFiles.saveAs({ name: suggestedName, content: serialized.content });
        if (!file) return { kind: 'canceled', message: 'Save As canceled.' };
        return { kind: 'success', value: { serialized, documentIdentity: {
          ...documentIdentity,
          displayName: file.name,
          documentFormat: serialized.documentFormat,
          sourceKind: 'file_handle',
          fileHandle: null,
          nativeFileToken: file.token,
          filePathHint: file.name,
          hasWritableBacking: true,
          isDirty: false,
          isUntitled: false,
          lastSavedAt: saveTime,
          lastPersistenceMethod: 'save_as_picker',
          lastPersistedContentHash: serialized.contentHash,
        } } };
      }
      if (typeof typedWindow.showSaveFilePicker === 'function') {
        let handle: FileSystemFileHandle | null = null;
        try {
          handle = await typedWindow.showSaveFilePicker({
            suggestedName,
            types: ACCEPT_TYPES,
            excludeAcceptAllOption: false,
          });
        } catch (error) {
          if (isAbortError(error)) {
            return {
              kind: 'canceled',
              message: 'Save As canceled.',
            };
          }
          if (error instanceof TypeError) {
            try {
              // Some browsers reject richer picker options; retry with minimal options.
              handle = await typedWindow.showSaveFilePicker({
                suggestedName,
              });
            } catch (retryError) {
              if (isAbortError(retryError)) {
                return {
                  kind: 'canceled',
                  message: 'Save As canceled.',
                };
              }
              if (retryError instanceof TypeError) {
                console.warn('[gr4-studio:file-workflow] save picker rejected options; falling back to download', {
                  suggestedName,
                });
              } else {
                throw retryError;
              }
            }
          } else {
            throw error;
          }
        }
        if (handle) {
          await writeFileHandle(handle, serialized.content);

          return {
            kind: 'success',
            value: {
              serialized,
              documentIdentity: {
                ...documentIdentity,
                displayName: sanitizeDisplayName(handle.name ?? suggestedName),
                documentFormat: serialized.documentFormat,
                sourceKind: 'file_handle',
                fileHandle: handle,
                filePathHint: handle.name ?? suggestedName,
                hasWritableBacking: true,
                isDirty: false,
                isUntitled: false,
                lastSavedAt: saveTime,
                lastPersistenceMethod: 'save_as_picker',
                lastPersistedContentHash: serialized.contentHash,
              },
            },
          };
        }
      }

      triggerDownload(win, suggestedName, serialized.content);
      return {
        kind: 'success',
        value: {
          serialized,
          documentIdentity: {
            ...documentIdentity,
            displayName: suggestedName,
            documentFormat: serialized.documentFormat,
            sourceKind: 'downloaded_export',
            fileHandle: null,
            filePathHint: suggestedName,
            hasWritableBacking: false,
            isDirty: false,
            isUntitled: false,
            lastSavedAt: saveTime,
            lastPersistenceMethod: 'download_fallback',
            lastPersistedContentHash: serialized.contentHash,
          },
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          kind: 'canceled',
          message: 'Save As canceled.',
        };
      }
      if (error instanceof TypeError) {
        console.warn('[gr4-studio:file-workflow] save write failed with TypeError; falling back to download', {
          suggestedName,
        });
        triggerDownload(win, suggestedName, serialized.content);
        return {
          kind: 'success',
          value: {
            serialized,
            documentIdentity: {
              ...documentIdentity,
              displayName: suggestedName,
              documentFormat: serialized.documentFormat,
              sourceKind: 'downloaded_export',
              fileHandle: null,
              filePathHint: suggestedName,
              hasWritableBacking: false,
              isDirty: false,
              isUntitled: false,
              lastSavedAt: saveTime,
              lastPersistenceMethod: 'download_fallback',
              lastPersistedContentHash: serialized.contentHash,
            },
          },
        };
      }

      return {
        kind: 'failed_io',
        message: toSaveIoErrorMessage(error),
        reason: 'io_error',
      };
    }
  };

  const saveCurrentDocument = async (
    documentIdentity: DocumentIdentityState,
    snapshot: EditorSnapshot,
    capabilities: DocumentPersistenceCapabilities,
  ): Promise<PersistenceResult<SaveDocumentSuccess>> => {
    const serialized = serializeEditorSnapshot(snapshot);

    if (nativeFiles && documentIdentity.hasWritableBacking && documentIdentity.nativeFileToken) {
      try {
        await nativeFiles.save({ token: documentIdentity.nativeFileToken, content: serialized.content });
        return { kind: 'success', value: { serialized, documentIdentity: {
          ...documentIdentity,
          documentFormat: serialized.documentFormat,
          isDirty: false,
          lastSavedAt: now(),
          lastPersistenceMethod: 'save_in_place',
          lastPersistedContentHash: serialized.contentHash,
        } } };
      } catch (error) {
        return { kind: 'failed_io', message: toSaveIoErrorMessage(error), reason: 'io_error' };
      }
    }
    if (documentIdentity.hasWritableBacking && documentIdentity.fileHandle) {
      try {
        await writeFileHandle(documentIdentity.fileHandle, serialized.content);
        return {
          kind: 'success',
          value: {
            serialized,
            documentIdentity: {
              ...documentIdentity,
              displayName: sanitizeDisplayName(documentIdentity.displayName),
              documentFormat: serialized.documentFormat,
              sourceKind: 'file_handle',
              hasWritableBacking: true,
              isUntitled: false,
              isDirty: false,
              lastSavedAt: now(),
              lastPersistenceMethod: 'save_in_place',
              lastPersistedContentHash: serialized.contentHash,
            },
          },
        };
      } catch (error) {
        if (error instanceof PermissionRevokedError) {
          return {
            kind: 'failed_io',
            message: 'File no longer writable or permission revoked. Use Save As.',
            reason: 'permission_revoked',
          };
        }
        return {
          kind: 'failed_io',
          message: toSaveIoErrorMessage(error),
          reason: 'io_error',
        };
      }
    }

    return saveCurrentDocumentAs(documentIdentity, snapshot, capabilities);
  };

  return {
    openDocument,
    saveCurrentDocument,
    saveCurrentDocumentAs,
  };
}
