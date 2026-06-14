import { useEffect, useMemo, useState } from 'react';
import type { Language, StorageItem } from '../api/types';
import { t } from '../i18n';
import { WindowFrame } from './WindowFrame';

type VirtualExplorerProps = {
  language: Language;
  items: StorageItem[];
  maximized: boolean;
  zIndex: number;
  initialFolderId?: string | null;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onOpenTextFile: (item: StorageItem) => void;
  onOpenAudioFile: (item: StorageItem) => void;
  onOpenImageFile: (item: StorageItem) => void;
  onOpenVideoFile: (item: StorageItem) => void;
  onSaveItems: (items: StorageItem[]) => Promise<void>;
  // Reports import progress (0..1) for the shared desktop progress bar; null clears it.
  onUploadProgress?: (fraction: number | null) => void;
};

const DESKTOP_FOLDER_ID = 'system-desktop';
const MAX_IMPORTED_FILE_SIZE = 50 * 1024 * 1024;
const MAX_IMPORTED_VIDEO_SIZE = 150 * 1024 * 1024;

// Per-file size cap: videos may be up to 150 MB, everything else up to 50 MB.
function maxImportSizeForFile(file: File) {
  const mimeType = inferMimeType(file);
  return mimeType.startsWith('video/') ? MAX_IMPORTED_VIDEO_SIZE : MAX_IMPORTED_FILE_SIZE;
}

function now() {
  return new Date().toISOString();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultName(type: StorageItem['type']) {
  return type === 'folder' ? 'New folder' : 'New text file.txt';
}

function childrenOf(items: StorageItem[], parentId: string | null) {
  return items.filter((item) => item.parentId === parentId).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function descendantsOf(items: StorageItem[], itemId: string) {
  const ids = new Set([itemId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }

  return ids;
}

function isAudioStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('audio/') || item.content?.startsWith('data:audio/'));
}

function isImageStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('image/') || item.content?.startsWith('data:image/'));
}

function isVideoStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('video/') || item.content?.startsWith('data:video/'));
}

function isSystemFolder(item: StorageItem) {
  return item.id === DESKTOP_FOLDER_ID;
}

function inferMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'ogg') return 'audio/ogg';
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'ogv') return 'video/ogg';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function dataUrlWithMime(dataUrl: string, mimeType: string) {
  if (!dataUrl.startsWith('data:application/octet-stream') || mimeType === 'application/octet-stream') return dataUrl;
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? `data:${mimeType};base64,${dataUrl.slice(commaIndex + 1)}` : dataUrl;
}

export function VirtualExplorer({
  language,
  items,
  maximized,
  zIndex,
  initialFolderId = null,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onOpenTextFile,
  onOpenAudioFile,
  onOpenImageFile,
  onOpenVideoFile,
  onSaveItems,
  onUploadProgress
}: VirtualExplorerProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState<
    | { type: 'item'; x: number; y: number; itemId: string }
    | { type: 'empty'; x: number; y: number }
    | null
  >(null);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const visibleItems = useMemo(() => childrenOf(items, currentFolderId), [currentFolderId, items]);
  const currentFolder = useMemo(() => items.find((item) => item.id === currentFolderId) ?? null, [currentFolderId, items]);
  const breadcrumbs = useMemo(() => {
    const chain: StorageItem[] = [];
    let folder = currentFolder;
    while (folder) {
      chain.unshift(folder);
      folder = items.find((item) => item.id === folder?.parentId) ?? null;
    }
    return chain;
  }, [currentFolder, items]);

  useEffect(() => {
    setCurrentFolderId(initialFolderId);
    setSelectedId(null);
  }, [initialFolderId]);

  useEffect(() => {
    setNameDraft(selectedItem?.name ?? '');
  }, [selectedItem]);

  async function persist(nextItems: StorageItem[]) {
    setSaving(true);
    setError('');

    try {
      await onSaveItems(nextItems);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t(language, 'unknownError'));
    } finally {
      setSaving(false);
    }
  }

  async function createItem(type: StorageItem['type']) {
    const timestamp = now();
    const nextItem: StorageItem = {
      id: makeId(),
      type,
      name: nameDraft.trim() || defaultName(type),
      parentId: currentFolderId,
      content: type === 'text' ? '' : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await persist([...items, nextItem]);
    setSelectedId(nextItem.id);
  }

  async function importFiles(files: FileList) {
    const incoming = Array.from(files);
    const oversized = incoming.find((file) => file.size > maxImportSizeForFile(file));
    if (oversized) {
      const limitMb = Math.round(maxImportSizeForFile(oversized) / (1024 * 1024));
      setError(`${oversized.name}: ${t(language, 'fileTooLargeLimit', { limit: String(limitMb) })}`);
      return;
    }

    const timestamp = now();
    const totalBytes = incoming.reduce((sum, file) => sum + file.size, 0) || 1;
    const readBytes = new Array(incoming.length).fill(0);
    const reportRead = () => {
      const done = readBytes.reduce((sum, value) => sum + value, 0);
      onUploadProgress?.((done / totalBytes) * 0.9);
    };
    onUploadProgress?.(0);

    try {
      const imported = await Promise.all(
        incoming.map(
          (file, index) =>
            new Promise<StorageItem>((resolve, reject) => {
              const mimeType = inferMimeType(file);
              const reader = new FileReader();
              reader.onerror = () => reject(new Error('Could not read file'));
              reader.onprogress = (event) => {
                if (event.lengthComputable) {
                  readBytes[index] = event.loaded;
                  reportRead();
                }
              };
              reader.onload = () => {
                readBytes[index] = file.size;
                reportRead();
                resolve({
                  id: makeId(),
                  type: 'file',
                  name: file.name,
                  parentId: currentFolderId,
                  content: dataUrlWithMime(String(reader.result ?? ''), mimeType),
                  mimeType,
                  size: file.size,
                  createdAt: timestamp,
                  updatedAt: timestamp
                });
              };
              reader.readAsDataURL(file);
            })
        )
      );

      onUploadProgress?.(0.92);
      await persist([...items, ...imported]);
      onUploadProgress?.(1);
    } finally {
      onUploadProgress?.(null);
    }
  }

  function openItem(item: StorageItem) {
    setSelectedId(item.id);
    if (item.type === 'folder') {
      setCurrentFolderId(item.id);
      setSelectedId(null);
      return;
    }
    if (item.type === 'text') onOpenTextFile(item);
    if (isAudioStorageItem(item)) onOpenAudioFile(item);
    if (isImageStorageItem(item)) onOpenImageFile(item);
    if (isVideoStorageItem(item)) onOpenVideoFile(item);
  }

  function openSelectedFromContext() {
    const item = items.find((candidate) => contextMenu?.type === 'item' && candidate.id === contextMenu.itemId);
    if (item) openItem(item);
    setContextMenu(null);
  }

  async function renameFromContext() {
    const item = items.find((candidate) => contextMenu?.type === 'item' && candidate.id === contextMenu.itemId);
    if (!item) return;
    if (isSystemFolder(item)) return;
    const nextName = window.prompt(t(language, 'rename'), item.name)?.trim();
    if (!nextName) return;
    const timestamp = now();
    await persist(items.map((candidate) => (candidate.id === item.id ? { ...candidate, name: nextName, updatedAt: timestamp } : candidate)));
    setContextMenu(null);
  }

  async function deleteFromContext() {
    const item = items.find((candidate) => contextMenu?.type === 'item' && candidate.id === contextMenu.itemId);
    if (!item) return;
    if (isSystemFolder(item)) return;
    const ids = descendantsOf(items, item.id);
    await persist(items.filter((candidate) => !ids.has(candidate.id)));
    setSelectedId(null);
    setContextMenu(null);
  }

  return (
    <WindowFrame
      language={language}
      title={t(language, 'explorer')}
      eyebrow={t(language, 'encryptedStorage')}
      className="explorer-window"
      maximized={maximized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 490), y: 72 }}
      storageKey="explorer"
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div
        className="explorer-toolbar"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button className="secondary-action" type="button" onClick={() => setCurrentFolderId(currentFolder?.parentId ?? null)}>
          {t(language, 'up')}
        </button>
        <input
          className="text-field explorer-name-field"
          value={nameDraft}
          placeholder={t(language, 'fileName')}
          onChange={(event) => setNameDraft(event.target.value)}
        />
        <button className="secondary-action" type="button" disabled={saving} onClick={() => void createItem('folder')}>
          {t(language, 'newFolder')}
        </button>
        <button className="secondary-action" type="button" disabled={saving} onClick={() => void createItem('text')}>
          {t(language, 'newTextFile')}
        </button>
      </div>

      <div className="explorer-path">/{breadcrumbs.map((item) => item.name).join('/')}</div>

      {error ? <div className="inline-error">{error}</div> : null}

      <div
        className="explorer-body explorer-body-single"
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          void importFiles(event.dataTransfer.files);
        }}
      >
        <div
          className="explorer-list explorer-list-grid"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if ((event.target as HTMLElement).closest('.explorer-item')) return;
            setContextMenu({ type: 'empty', x: event.clientX, y: event.clientY });
          }}
          onClick={() => setContextMenu(null)}
        >
          {visibleItems.length === 0 ? <div className="explorer-empty">{t(language, 'emptyFolder')}</div> : null}
          {visibleItems.map((item) => (
            <button
              key={item.id}
              className={selectedId === item.id ? 'explorer-item active' : 'explorer-item'}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/notoc-storage-item', JSON.stringify(item));
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => setSelectedId(item.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedId(item.id);
                setContextMenu({ type: 'item', itemId: item.id, x: event.clientX, y: event.clientY });
              }}
              onDoubleClick={() => openItem(item)}
            >
              <span className={`explorer-item-icon explorer-item-icon-${isVideoStorageItem(item) ? 'video' : isImageStorageItem(item) ? 'image' : item.type}`}>{item.type === 'folder' ? 'DIR' : item.type === 'text' ? 'TXT' : isAudioStorageItem(item) ? 'MP' : isImageStorageItem(item) ? 'IMG' : isVideoStorageItem(item) ? 'VID' : 'FILE'}</span>
              <span>{item.name}</span>
              <small>{item.type === 'folder' ? t(language, 'folder') : item.type === 'text' ? t(language, 'textFile') : `${Math.ceil((item.size ?? 0) / 1024)} KB`}</small>
            </button>
          ))}
        </div>
      </div>

      {contextMenu ? (
        <div className="context-menu explorer-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.type === 'item' ? (
            <>
              <button type="button" onClick={openSelectedFromContext}>{t(language, 'open')}</button>
              {items.find((item) => item.id === contextMenu.itemId)?.id !== DESKTOP_FOLDER_ID ? <button type="button" onClick={() => void renameFromContext()}>{t(language, 'rename')}</button> : null}
              {items.find((item) => item.id === contextMenu.itemId)?.id !== DESKTOP_FOLDER_ID ? <button className="danger-text" type="button" onClick={() => void deleteFromContext()}>{t(language, 'delete')}</button> : null}
            </>
          ) : (
            <>
              <button type="button" onClick={() => void createItem('folder')}>{t(language, 'newFolder')}</button>
              <button type="button" onClick={() => void createItem('text')}>{t(language, 'newTextFile')}</button>
            </>
          )}
        </div>
      ) : null}
    </WindowFrame>
  );
}
