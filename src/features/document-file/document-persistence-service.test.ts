import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPersistenceService, type DocumentIdentityState } from './document-persistence-service';
import type { DocumentPersistenceCapabilities } from './document-persistence-capabilities';
import type { EditorSnapshot } from '../graph-tabs/store/graphTabsStore';

function createSnapshot(name = 'Example'): EditorSnapshot {
  return {
    metadata: {
      name,
      description: undefined,
    },
    nodes: [],
    edges: [],
  };
}

function createCapabilities(overrides: Partial<DocumentPersistenceCapabilities> = {}): DocumentPersistenceCapabilities {
  return {
    canUseFileSystemAccessApi: true,
    canSaveInPlace: true,
    canPromptForSaveLocation: true,
    usesDownloadFallback: false,
    canOpenWithPicker: true,
    ...overrides,
  };
}

function createIdentity(overrides: Partial<DocumentIdentityState> = {}): DocumentIdentityState {
  return {
    internalDocumentId: 'document-1',
    displayName: 'example.gr4s',
    documentFormat: 'gr4-studio.graph@1',
    sourceKind: 'file_handle',
    fileHandle: null,
    filePathHint: 'example.gr4s',
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

describe('document persistence service', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('Save writes in place when writable backing handle exists', async () => {
    const createWritable = vi.fn().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const handle = {
      name: 'in-place.gr4s',
      createWritable,
    } as unknown as FileSystemFileHandle;

    const service = createDocumentPersistenceService({
      win: {} as Window,
      now: () => '2026-03-24T12:00:00.000Z',
    });

    const result = await service.saveCurrentDocument(
      createIdentity({
        fileHandle: handle,
        hasWritableBacking: true,
        sourceKind: 'file_handle',
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }

    expect(createWritable).toHaveBeenCalledTimes(1);
    expect(result.value.documentIdentity.lastPersistenceMethod).toBe('save_in_place');
    expect(result.value.documentIdentity.isDirty).toBe(false);
  });

  it('Save As succeeds via picker when permission probe throws TypeError but writer works', async () => {
    const handle = {
      name: 'picker-save.gr4s',
      queryPermission: vi.fn().mockRejectedValue(new TypeError('descriptor unsupported')),
      requestPermission: vi.fn().mockRejectedValue(new TypeError('descriptor unsupported')),
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as FileSystemFileHandle;
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.value.documentIdentity.lastPersistenceMethod).toBe('save_as_picker');
      expect(result.value.documentIdentity.hasWritableBacking).toBe(true);
      expect(result.value.documentIdentity.sourceKind).toBe('file_handle');
    }
  });

  it('Save on untitled document routes through Save As picker', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'saved-as.gr4s',
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    } as unknown as FileSystemFileHandle);
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocument(
      createIdentity({
        displayName: 'Untitled.gr4s',
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }
    expect(result.value.documentIdentity.lastPersistenceMethod).toBe('save_as_picker');
    expect(result.value.documentIdentity.hasWritableBacking).toBe(true);
  });

  it('Save As uses live picker API even when capability flags are stale false', async () => {
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'stale-capabilities.gr4s',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as FileSystemFileHandle);
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities({
        canUseFileSystemAccessApi: false,
        canPromptForSaveLocation: false,
        canSaveInPlace: false,
        canOpenWithPicker: false,
        usesDownloadFallback: true,
      }),
    );

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.value.documentIdentity.lastPersistenceMethod).toBe('save_as_picker');
      expect(result.value.documentIdentity.hasWritableBacking).toBe(true);
    }
  });

  it('Save on untitled document with canceled Save As returns canceled', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError'));
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocument(
      createIdentity({
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(result.kind).toBe('canceled');
  });

  it('Save As sanitizes invalid filename suggestions before invoking picker', async () => {
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'clean-name.gr4s',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as FileSystemFileHandle);
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        displayName: 'bad/name:with*chars?.gr4s',
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(result.kind).toBe('success');
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    const options = showSaveFilePicker.mock.calls[0]?.[0] as { suggestedName?: string } | undefined;
    expect(options?.suggestedName).toBe('bad_name_with_chars_.gr4s');
  });

  it('Save As falls back to download when picker throws TypeError twice', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new TypeError('Invalid suggestedName'));
    const click = vi.fn();
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
        document: {
          createElement: vi.fn().mockReturnValue({
            click,
          }),
        },
      } as unknown as Window,
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://doc');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        displayName: 'bad/name.gr4s',
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(result.kind).toBe('success');
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(1);
    if (result.kind === 'success') {
      expect(result.value.documentIdentity.sourceKind).toBe('downloaded_export');
      expect(result.value.documentIdentity.lastPersistenceMethod).toBe('download_fallback');
    }
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('Save As retries picker with minimal options when rich options throw TypeError', async () => {
    const handle = {
      name: 'retry-success.gr4s',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as FileSystemFileHandle;
    const showSaveFilePicker = vi.fn()
      .mockRejectedValueOnce(new TypeError('Invalid option payload'))
      .mockResolvedValueOnce(handle);

    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        displayName: 'name with spaces    .gr4s',
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(result.kind).toBe('success');
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect(showSaveFilePicker.mock.calls[0]?.[0]).toMatchObject({
      suggestedName: 'name with spaces .gr4s',
      types: expect.any(Array),
      excludeAcceptAllOption: false,
    });
    expect(showSaveFilePicker.mock.calls[1]?.[0]).toMatchObject({
      suggestedName: 'name with spaces .gr4s',
    });
    expect(showSaveFilePicker.mock.calls[1]?.[0]).not.toHaveProperty('types');
  });

  it('Save As falls back to download when picker rejects both rich and minimal options', async () => {
    const showSaveFilePicker = vi.fn()
      .mockRejectedValueOnce(new TypeError('Invalid option payload'))
      .mockRejectedValueOnce(new TypeError('Invalid suggestedName'));
    const click = vi.fn();
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
        document: {
          createElement: vi.fn().mockReturnValue({
            click,
          }),
        },
      } as unknown as Window,
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://doc');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        displayName: 'bad/name.gr4s',
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('success');
    expect(click).toHaveBeenCalledTimes(1);
    if (result.kind === 'success') {
      expect(result.value.documentIdentity.sourceKind).toBe('downloaded_export');
      expect(result.value.documentIdentity.lastPersistenceMethod).toBe('download_fallback');
      expect(result.value.documentIdentity.hasWritableBacking).toBe(false);
    }
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('Save As falls back to download when picker succeeds but file write throws TypeError', async () => {
    const handle = {
      name: 'write-fails.gr4s',
      createWritable: vi.fn().mockRejectedValue(new TypeError('Invalid writer state')),
    } as unknown as FileSystemFileHandle;
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
    const click = vi.fn();
    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
        document: {
          createElement: vi.fn().mockReturnValue({
            click,
          }),
        },
      } as unknown as Window,
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://doc');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        displayName: 'fallback-on-write.gr4s',
        sourceKind: 'untitled',
        isUntitled: true,
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('success');
    expect(click).toHaveBeenCalledTimes(1);
    if (result.kind === 'success') {
      expect(result.value.documentIdentity.sourceKind).toBe('downloaded_export');
      expect(result.value.documentIdentity.lastPersistenceMethod).toBe('download_fallback');
      expect(result.value.documentIdentity.hasWritableBacking).toBe(false);
    }
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('Save on imported unbacked document routes through Save As', async () => {
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'imported-copy.gr4s',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as FileSystemFileHandle);

    const service = createDocumentPersistenceService({
      win: {
        showSaveFilePicker,
      } as unknown as Window,
    });

    const result = await service.saveCurrentDocument(
      createIdentity({
        sourceKind: 'imported_file',
        hasWritableBacking: false,
        fileHandle: null,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('success');
  });

  it('Save As download fallback marks document clean but unbacked', async () => {
    const click = vi.fn();
    const service = createDocumentPersistenceService({
      win: {
        document: {
          createElement: vi.fn().mockReturnValue({
            click,
          }),
        },
      } as unknown as Window,
      now: () => '2026-03-24T12:00:00.000Z',
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://doc');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await service.saveCurrentDocumentAs(
      createIdentity({
        sourceKind: 'imported_file',
        hasWritableBacking: false,
      }),
      createSnapshot(),
      createCapabilities({
        canUseFileSystemAccessApi: false,
        canPromptForSaveLocation: false,
        canOpenWithPicker: false,
        canSaveInPlace: false,
        usesDownloadFallback: true,
      }),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }
    expect(click).toHaveBeenCalledTimes(1);
    expect(result.value.documentIdentity.sourceKind).toBe('downloaded_export');
    expect(result.value.documentIdentity.hasWritableBacking).toBe(false);
    expect(result.value.documentIdentity.isDirty).toBe(false);
    expect(result.value.documentIdentity.lastPersistenceMethod).toBe('download_fallback');
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('subsequent Save after fallback download routes back through fallback Save As', async () => {
    const click = vi.fn();
    const service = createDocumentPersistenceService({
      win: {
        document: {
          createElement: vi.fn().mockReturnValue({
            click,
          }),
        },
      } as unknown as Window,
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://doc');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const first = await service.saveCurrentDocumentAs(
      createIdentity({
        sourceKind: 'imported_file',
        hasWritableBacking: false,
      }),
      createSnapshot(),
      createCapabilities({
        canUseFileSystemAccessApi: false,
        canPromptForSaveLocation: false,
        canOpenWithPicker: false,
        canSaveInPlace: false,
        usesDownloadFallback: true,
      }),
    );
    expect(first.kind).toBe('success');
    if (first.kind !== 'success') {
      return;
    }

    click.mockClear();
    const second = await service.saveCurrentDocument(
      first.value.documentIdentity,
      createSnapshot('Second'),
      createCapabilities({
        canUseFileSystemAccessApi: false,
        canPromptForSaveLocation: false,
        canOpenWithPicker: false,
        canSaveInPlace: false,
        usesDownloadFallback: true,
      }),
    );

    expect(second.kind).toBe('success');
    expect(click).toHaveBeenCalledTimes(1);
    if (second.kind === 'success') {
      expect(second.value.documentIdentity.lastPersistenceMethod).toBe('download_fallback');
      expect(second.value.documentIdentity.hasWritableBacking).toBe(false);
    }
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('Open parse failure returns failed_validation and does not replace document', async () => {
    const handle = {
      getFile: vi.fn().mockResolvedValue({
        name: 'bad.grc',
        text: vi.fn().mockResolvedValue('{not-json'),
      }),
    } as unknown as FileSystemFileHandle;

    const service = createDocumentPersistenceService({
      win: {
        showOpenFilePicker: vi.fn().mockResolvedValue([handle]),
      } as unknown as Window,
    });

    const result = await service.openDocument(createCapabilities());
    expect(result.kind).toBe('failed_validation');
  });

  it('Open accepts legacy .grc filename via import path', async () => {
    const validDocument = JSON.stringify({
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'legacy' },
      graph: {
        nodes: [],
        edges: [],
      },
    });

    const service = createDocumentPersistenceService({
      win: {
        document: {
          createElement: vi.fn().mockImplementation(() => {
            const input = {
              type: '',
              accept: '',
              files: [
                {
                  name: 'legacy.grc',
                  text: () => Promise.resolve(validDocument),
                },
              ],
              onchange: null as (() => void) | null,
              oncancel: null as (() => void) | null,
              click: () => {
                input.onchange?.();
              },
            };
            return input;
          }),
        },
      } as unknown as Window,
    });

    const result = await service.openDocument(
      createCapabilities({
        canUseFileSystemAccessApi: false,
        canOpenWithPicker: false,
      }),
    );

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.value.documentIdentity.displayName).toBe('legacy.grc');
      expect(result.value.documentIdentity.sourceKind).toBe('imported_file');
    }
  });

  it('Open picker only advertises .gr4s as a native Studio graph file', async () => {
    const showOpenFilePicker = vi.fn().mockResolvedValue([]);
    const service = createDocumentPersistenceService({
      win: {
        showOpenFilePicker,
      } as unknown as Window,
    });

    await service.openDocument(createCapabilities());

    expect(showOpenFilePicker).toHaveBeenCalledTimes(1);
    expect(showOpenFilePicker.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        types: [
          expect.objectContaining({
            accept: {
              'application/json': ['.gr4s'],
            },
          }),
        ],
      }),
    );
  });

  it('fallback Open cancel returns canceled', async () => {
    let capturedInput: { oncancel: (() => void) | null; click: () => void } | null = null;
    const service = createDocumentPersistenceService({
      win: {
        document: {
          createElement: vi.fn().mockImplementation(() => {
            const input = {
              type: '',
              accept: '',
              files: null,
              onchange: null,
              oncancel: null as (() => void) | null,
              click: () => {
                (input.oncancel as (() => void) | null)?.();
              },
            };
            capturedInput = input;
            return input;
          }),
        },
      } as unknown as Window,
    });

    const result = await service.openDocument(
      createCapabilities({
        canUseFileSystemAccessApi: false,
        canOpenWithPicker: false,
      }),
    );

    expect(capturedInput).toBeTruthy();
    expect(result.kind).toBe('canceled');
  });

  it('Permission loss during in-place Save returns failed_io', async () => {
    const handle = {
      name: 'revoked.gr4s',
      queryPermission: vi.fn().mockResolvedValue('denied'),
      createWritable: vi.fn().mockRejectedValue(new Error('permission denied')),
    } as unknown as FileSystemFileHandle;

    const service = createDocumentPersistenceService({
      win: {} as Window,
    });

    const result = await service.saveCurrentDocument(
      createIdentity({
        sourceKind: 'file_handle',
        fileHandle: handle,
        hasWritableBacking: true,
      }),
      createSnapshot(),
      createCapabilities(),
    );

    expect(result.kind).toBe('failed_io');
    if (result.kind === 'failed_io') {
      expect(result.reason).toBe('permission_revoked');
    }
  });
});

describe('native document persistence', () => {
  it('uses desktop dialogs and an opaque token instead of browser pickers', async () => {
    const save = vi.fn().mockResolvedValue({ token: 'native-1', name: 'flow.gr4s' });
    const saveAs = vi.fn().mockResolvedValue({ token: 'native-1', name: 'flow.gr4s' });
    const browserPicker = vi.fn();
    const service = createDocumentPersistenceService({ win: {
      gr4StudioShell: { capabilities: { nativeFiles: true }, documents: { saveAs, save } },
      showSaveFilePicker: browserPicker,
    } as unknown as Window });
    const saved = await service.saveCurrentDocumentAs(createIdentity(), createSnapshot(), createCapabilities());
    expect(saved.kind).toBe('success');
    if (saved.kind !== 'success') return;
    expect(saved.value.documentIdentity.nativeFileToken).toBe('native-1');
    const next = await service.saveCurrentDocument(saved.value.documentIdentity, createSnapshot('Changed'), createCapabilities());
    expect(next.kind).toBe('success');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ token: 'native-1' }));
    expect(saveAs).toHaveBeenCalledOnce();
    expect(browserPicker).not.toHaveBeenCalled();
  });
  it('does not clear dirty state when a native save fails', async () => {
    const service = createDocumentPersistenceService({ win: {
      gr4StudioShell: { capabilities: { nativeFiles: true }, documents: { save: vi.fn().mockRejectedValue(Error('disk full')) } },
    } as unknown as Window });
    const identity = createIdentity({ nativeFileToken: 'native-1', hasWritableBacking: true });
    const result = await service.saveCurrentDocument(identity, createSnapshot(), createCapabilities());
    expect(result.kind).toBe('failed_io');
    expect(identity.isDirty).toBe(true);
  });
});
