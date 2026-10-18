import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { t } from '../i18n';
import type { PresenceStatus } from '../utils/user-status';

// A single entry shown in the rail (a friend or a group). The host maps its own
// domain object (PublicUser / Group) into this shape.
export type RailItem = {
  id: string;
  name: string;
  avatar: string;
  // Optional presence dot. Custom statuses are used for the current user.
  presence?: 'online' | 'offline' | PresenceStatus | null;
  typing?: boolean;
  unread?: number;
  active?: boolean;
  onOpen: () => void;
  // Host-specific context menu (e.g. friend actions). Optional.
  onContextMenu?: (event: ReactMouseEvent) => void;
};

type RailFolder = {
  id: string;
  name: string;
  itemIds: string[];
};

type RailFoldersProps = {
  // Stable storage scope so friends and groups keep separate folder layouts.
  scope: string;
  language: Language;
  items: RailItem[];
  // Number of avatar tiles shown on a collapsed folder before the "+N" overflow.
  previewCount?: number;
};

// Layout describes the order of top-level rail entries: either a loose item or
// a folder. Items not referenced anywhere are appended (loose) at the end.
type LayoutEntry = { type: 'item'; id: string } | { type: 'folder'; id: string };

type RailLayout = {
  folders: RailFolder[];
  order: LayoutEntry[];
};

function storageKey(scope: string) {
  return `notoc.rail.folders.${scope}`;
}

function loadLayout(scope: string): RailLayout {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return { folders: [], order: [] };
    const parsed = JSON.parse(raw) as RailLayout;
    if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.order)) return { folders: [], order: [] };
    return parsed;
  } catch {
    return { folders: [], order: [] };
  }
}

function saveLayout(scope: string, layout: RailLayout) {
  try { localStorage.setItem(storageKey(scope), JSON.stringify(layout)); } catch { /* ignore */ }
}

let folderSeq = 0;
function newFolderId() {
  folderSeq += 1;
  return `folder-${Date.now().toString(36)}-${folderSeq}`;
}

const FALLBACK_FOLDER_AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23555" rx="20"/></svg>';

// What is being dragged and from where.
type DragState = {
  id: string;
  kind: 'item' | 'folder';
  fromFolder?: string;
};

// Where the drop will land:
//  - { type: 'reorder', before } -> insert at top level before `before` ('end' = append)
//  - { type: 'merge', targetId } -> merge into folder/create folder with targetId
//  - { type: 'folder-member', folderId, before } -> reorder inside an open folder
type DropTarget =
  | { type: 'reorder'; before: string | 'end' }
  | { type: 'merge'; targetId: string }
  | { type: 'folder-member'; folderId: string; before: string | 'end' };

export function RailFolders({ scope, language, items, previewCount = 4 }: RailFoldersProps) {
  const [layout, setLayout] = useState<RailLayout>(() => loadLayout(scope));
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RailFolder | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; folder: RailFolder } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  // Reconcile persisted layout against the live item list: drop ids that no
  // longer exist and append brand-new items as loose entries.
  // IMPORTANT: we only remove an item from a folder when it is confirmed absent
  // from the live list AND the live list is non-empty (to avoid wiping folders
  // during the initial render before data has loaded).
  useEffect(() => {
    if (items.length === 0) return; // wait until data is loaded before reconciling
    setLayout((current) => {
      const liveIds = new Set(items.map((i) => i.id));
      // Keep folder item ids that are still live; preserve folders that have at
      // least one live member OR still have members we haven't seen yet (i.e.
      // keep the folder structure intact even if some members are temporarily
      // absent — they'll be reconciled on the next render once loaded).
      const folders = current.folders
        .map((f) => ({ ...f, itemIds: f.itemIds.filter((id) => liveIds.has(id)) }))
        .filter((f) => f.itemIds.length > 0);
      const folderIds = new Set(folders.map((f) => f.id));
      const placed = new Set<string>();
      folders.forEach((f) => f.itemIds.forEach((id) => placed.add(id)));

      const order: LayoutEntry[] = [];
      for (const entry of current.order) {
        if (entry.type === 'folder') {
          if (folderIds.has(entry.id) && !order.some((e) => e.type === 'folder' && e.id === entry.id)) order.push(entry);
        } else if (liveIds.has(entry.id) && !placed.has(entry.id) && !order.some((e) => e.type === 'item' && e.id === entry.id)) {
          order.push(entry);
        }
      }
      // Append folders missing from order.
      for (const f of folders) {
        if (!order.some((e) => e.type === 'folder' && e.id === f.id)) order.push({ type: 'folder', id: f.id });
      }
      // Append new loose items (not yet placed anywhere).
      for (const item of items) {
        if (placed.has(item.id)) continue;
        if (!order.some((e) => e.type === 'item' && e.id === item.id)) order.push({ type: 'item', id: item.id });
      }
      const next = { folders, order };
      // Avoid an extra render/save when nothing actually changed.
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      return next;
    });
  }, [items]);

  // Persist whenever the layout changes.
  useEffect(() => { saveLayout(scope, layout); }, [scope, layout]);

  // Close the open folder if it disappeared (all items removed).
  useEffect(() => {
    if (openFolderId && !layout.folders.some((f) => f.id === openFolderId)) setOpenFolderId(null);
  }, [layout.folders, openFolderId]);

  // Dismiss the rename context menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('.context-menu')) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menu]);

  // ── Drag helpers ────────────────────────────────────────────────────────────

  function startDrag(e: DragEvent, id: string, kind: 'item' | 'folder', fromFolder?: string) {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers need data set to allow the drag.
    try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
    setDrag({ id, kind, fromFolder });
    setDropTarget(null);
  }

  function endDrag() {
    setDrag(null);
    setDropTarget(null);
  }

  // Decide the drop target while hovering over a specific TOP-LEVEL entry.
  // Top third  -> insert before this entry
  // Bottom third -> insert before the NEXT entry (i.e. after this one)
  // Middle (items & collapsed folders only) -> merge / create folder
  function dropTargetForEntry(
    e: DragEvent<HTMLElement>,
    entry: { id: string; kind: 'item' | 'folder' },
    nextEntryId: string | 'end'
  ): DropTarget {
    if (!drag) return { type: 'reorder', before: entry.id };
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const draggingItem = drag.kind === 'item';

    // Merge only makes sense when dragging an item over another item/folder
    // (and not onto itself). Reserve the middle band for merging.
    const canMerge = draggingItem && drag.id !== entry.id;

    if (canMerge && ratio >= 0.3 && ratio <= 0.7) {
      return { type: 'merge', targetId: entry.id };
    }
    if (ratio < 0.5) return { type: 'reorder', before: entry.id };
    return { type: 'reorder', before: nextEntryId };
  }

  function handleEntryDragOver(
    e: DragEvent<HTMLElement>,
    entry: { id: string; kind: 'item' | 'folder' },
    nextEntryId: string | 'end'
  ) {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(dropTargetForEntry(e, entry, nextEntryId));
  }

  // Hovering empty space in the list. Children (entries) call stopPropagation in
  // their own onDragOver, so reaching here means we're in a gap or below the last
  // entry. Resolve the nearest entry boundary so reordering still works in gaps.
  function handleListDragOver(e: DragEvent<HTMLDivElement>) {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const list = listRef.current;
    if (!list) { setDropTarget({ type: 'reorder', before: 'end' }); return; }
    // Find the first top-level entry whose vertical midpoint is below the cursor.
    const wraps = Array.from(list.children).filter((c) => (c as HTMLElement).classList.contains('rail-entry-wrap')) as HTMLElement[];
    for (let i = 0; i < wraps.length; i += 1) {
      const rect = wraps[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        const entry = layout.order[i];
        if (entry) { setDropTarget({ type: 'reorder', before: entry.id }); return; }
      }
    }
    setDropTarget({ type: 'reorder', before: 'end' });
  }

  function commitDrop() {
    if (!drag || !dropTarget) { endDrag(); return; }
    const { id, kind, fromFolder } = drag;
    const target = dropTarget;
    endDrag();

    setLayout((current) => {
      // Helper to remove the dragged entity from everywhere.
      function removeDragged(layout: RailLayout): RailLayout {
        let folders = layout.folders.map((f) => ({ ...f, itemIds: [...f.itemIds] }));
        let order = layout.order.filter((e) =>
          kind === 'item' ? !(e.type === 'item' && e.id === id) : !(e.type === 'folder' && e.id === id)
        );
        if (kind === 'item') {
          folders = folders.map((f) => ({ ...f, itemIds: f.itemIds.filter((fid) => fid !== id) }));
        }
        folders = folders.filter((f) => f.itemIds.length > 0);
        const surviving = new Set(folders.map((f) => f.id));
        order = order.filter((e) => e.type !== 'folder' || surviving.has(e.id));
        return { folders, order };
      }

      if (target.type === 'merge') {
        // Merge dragged item into target (folder or loose item).
        if (kind !== 'item' || id === target.targetId) return current;

        const targetFolder = current.folders.find((f) => f.id === target.targetId);
        const base = removeDragged(current);

        if (targetFolder) {
          // Add into existing folder.
          const folders = base.folders.map((f) =>
            f.id === target.targetId && !f.itemIds.includes(id) ? { ...f, itemIds: [...f.itemIds, id] } : f
          );
          return { folders, order: base.order };
        }

        // Target is a loose item -> create a new folder containing both.
        const targetIsLoose = base.order.some((e) => e.type === 'item' && e.id === target.targetId);
        if (!targetIsLoose) return current;
        const folder: RailFolder = { id: newFolderId(), name: t(language, 'newFolder'), itemIds: [target.targetId, id] };
        const order: LayoutEntry[] = [];
        for (const e of base.order) {
          if (e.type === 'item' && e.id === target.targetId) {
            order.push({ type: 'folder', id: folder.id });
          } else {
            order.push(e);
          }
        }
        return { folders: [...base.folders, folder], order };
      }

      // Reorder at the top level (also handles ejecting from a folder).
      const base = removeDragged(current);
      const newEntry: LayoutEntry = kind === 'item' ? { type: 'item', id } : { type: 'folder', id };
      let order = base.order;
      if (target.before === 'end') {
        order = [...order, newEntry];
      } else {
        const idx = order.findIndex((e) => e.id === target.before);
        order = idx === -1 ? [...order, newEntry] : [...order.slice(0, idx), newEntry, ...order.slice(idx)];
      }
      void fromFolder;
      return { folders: base.folders, order };
    });
  }

  // Reorder inside an open folder, or merge an external item into it.
  function handleFolderMemberDrop(folderId: string, beforeMemberId: string | 'end') {
    if (!drag || drag.kind !== 'item') { endDrag(); return; }
    const sourceId = drag.id;
    endDrag();

    setLayout((current) => {
      // Remove source from all folders + loose order first.
      let folders = current.folders.map((f) => ({ ...f, itemIds: f.itemIds.filter((id) => id !== sourceId) }));
      let order = current.order.filter((e) => !(e.type === 'item' && e.id === sourceId));

      folders = folders.map((f) => {
        if (f.id !== folderId) return f;
        const ids = [...f.itemIds];
        if (beforeMemberId === 'end') ids.push(sourceId);
        else {
          const idx = ids.indexOf(beforeMemberId);
          if (idx === -1) ids.push(sourceId);
          else ids.splice(idx, 0, sourceId);
        }
        return { ...f, itemIds: ids };
      });

      folders = folders.filter((f) => f.itemIds.length > 0);
      const surviving = new Set(folders.map((f) => f.id));
      order = order.filter((e) => e.type !== 'folder' || surviving.has(e.id));
      return { folders, order };
    });
  }

  function commitRename() {
    if (!renameTarget) return;
    const name = renameDraft.trim() || t(language, 'newFolder');
    setLayout((current) => ({
      ...current,
      folders: current.folders.map((f) => (f.id === renameTarget.id ? { ...f, name } : f))
    }));
    setRenameTarget(null);
    setRenameDraft('');
  }

  // ── Render helpers ───────────────────────────────────────────────────────────

  function showTooltip(event: ReactMouseEvent, label: string) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ x: rect.right + 10, y: rect.top + rect.height / 2, label });
  }

  function ejectFromFolder(itemId: string, folderId: string) {
    setLayout((current) => {
      const folders: RailFolder[] = [];
      for (const f of current.folders) {
        if (f.id === folderId) {
          const itemIds = f.itemIds.filter((id) => id !== itemId);
          if (itemIds.length > 0) folders.push({ ...f, itemIds });
        } else {
          folders.push(f);
        }
      }
      const survived = folders.some((f) => f.id === folderId);
      let order = [...current.order, { type: 'item', id: itemId } as LayoutEntry];
      if (!survived) order = order.filter((en) => !(en.type === 'folder' && en.id === folderId));
      return { folders, order };
    });
  }

  // Avatar/folder button shared rendering. `inFolder` set => rendered inside an
  // open folder body (member reordering / ejection apply).
  function renderItem(item: RailItem, inFolder: string | undefined, nextEntryId: string | 'end') {
    const mergeHere = dropTarget?.type === 'merge' && dropTarget.targetId === item.id;
    return (
      <button
        type="button"
        className={['messenger-rail-avatar', item.active ? 'active' : '', drag?.id === item.id ? 'dragging' : '', mergeHere ? 'drop-target' : ''].filter(Boolean).join(' ')}
        title={item.name}
        draggable
        onDragStart={(e) => startDrag(e, item.id, 'item', inFolder)}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (!drag) return;
          if (inFolder) {
            // Reorder inside the folder: top half = before, bottom = after.
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const before = (e.clientY < rect.top + rect.height / 2) ? item.id : nextEntryId;
            setDropTarget({ type: 'folder-member', folderId: inFolder, before });
          } else {
            handleEntryDragOver(e, { id: item.id, kind: 'item' }, nextEntryId);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (inFolder) {
            const dt = dropTarget;
            if (dt?.type === 'folder-member') handleFolderMemberDrop(dt.folderId, dt.before);
            else endDrag();
          } else {
            commitDrop();
          }
        }}
        onClick={() => item.onOpen()}
        onMouseEnter={(e) => showTooltip(e, item.name)}
        onMouseLeave={() => setTooltip(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (inFolder) {
            ejectFromFolder(item.id, inFolder);
            return;
          }
          item.onContextMenu?.(e);
        }}
      >
        <span className="messenger-rail-avatar-media">
          <img src={item.avatar} alt="" draggable={false} />
          {item.presence ? (
            <i className={`${item.presence === 'online' ? 'presence-dot online' : item.presence === 'offline' ? 'presence-dot' : `presence-dot status-${item.presence}`}${item.typing ? ' typing' : ''}`}>
              {item.typing ? <span className="typing-presence-dots" aria-hidden="true"><b /><b /><b /></span> : null}
            </i>
          ) : null}
        </span>
        {item.unread && item.unread > 0 ? <span className="unread-badge avatar-badge">{item.unread > 9 ? '9+' : item.unread}</span> : null}
      </button>
    );
  }

  function renderFolder(folder: RailFolder, open: boolean, nextEntryId: string | 'end') {
    const members = folder.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as RailItem[];
    const preview = members.slice(0, previewCount);
    const totalUnread = members.reduce((sum, m) => sum + (m.unread ?? 0), 0);
    const mergeHere = dropTarget?.type === 'merge' && dropTarget.targetId === folder.id;
    return (
      <button
        type="button"
        className={[
          open ? 'messenger-rail-folder open' : 'messenger-rail-folder',
          drag?.id === folder.id ? 'dragging' : '',
          mergeHere ? 'drop-target' : ''
        ].filter(Boolean).join(' ')}
        onClick={() => { setTooltip(null); setOpenFolderId((cur) => (cur === folder.id ? null : folder.id)); }}
        onMouseEnter={(e) => showTooltip(e, folder.name)}
        onMouseLeave={() => setTooltip(null)}
        draggable={!open}
        onDragStart={(e) => { if (!open) startDrag(e, folder.id, 'folder'); }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (!drag) return;
          if (open) {
            // Dragging an item over the open folder header = merge into it.
            if (drag.kind === 'item') {
              e.preventDefault();
              e.stopPropagation();
              setDropTarget({ type: 'merge', targetId: folder.id });
            }
            return;
          }
          handleEntryDragOver(e, { id: folder.id, kind: 'folder' }, nextEntryId);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          commitDrop();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTooltip(null);
          setMenu({ x: Math.min(e.clientX, window.innerWidth - 170), y: Math.min(e.clientY, window.innerHeight - 80), folder });
        }}
      >
        {open ? (
          <span className="messenger-rail-folder-icon">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
          </span>
        ) : (
          <span className="messenger-rail-folder-grid">
            {preview.map((m) => <img key={m.id} src={m.avatar || FALLBACK_FOLDER_AVATAR} alt="" draggable={false} />)}
          </span>
        )}
        {totalUnread > 0 && !open ? <span className="unread-badge avatar-badge">{totalUnread > 9 ? '9+' : totalUnread}</span> : null}
      </button>
    );
  }

  const openFolder = openFolderId ? layout.folders.find((f) => f.id === openFolderId) ?? null : null;
  const openMembers = openFolder
    ? (openFolder.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as RailItem[])
    : [];

  // Indicator shown before a given top-level entry id during a reorder drag.
  function indicatorBefore(entryId: string | 'end') {
    return drag && dropTarget?.type === 'reorder' && dropTarget.before === entryId;
  }

  return (
    <>
      <div
        ref={listRef}
        className="rail-list-body"
        onDragOver={handleListDragOver}
        onDrop={(e) => { e.preventDefault(); commitDrop(); }}
      >
        {layout.order.map((entry, index) => {
          const entryId = entry.id;
          const nextEntry = layout.order[index + 1];
          const nextEntryId: string | 'end' = nextEntry ? nextEntry.id : 'end';

          if (entry.type === 'folder') {
            const folder = layout.folders.find((f) => f.id === entryId);
            if (!folder) return null;
            const isOpen = openFolderId === folder.id;
            return (
              <div key={folder.id} className="rail-entry-wrap">
                {indicatorBefore(entryId) ? <div className="rail-insert-indicator" /> : null}
                {isOpen ? (
                  <div className="messenger-rail-folder-open">
                    {renderFolder(folder, true, nextEntryId)}
                    <div
                      className="messenger-rail-folder-open-body"
                      onDragOver={(e) => {
                        // Hovering the empty area below members = append to folder.
                        if (drag?.kind === 'item') {
                          e.preventDefault();
                          setDropTarget({ type: 'folder-member', folderId: folder.id, before: 'end' });
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const dt = dropTarget;
                        if (dt?.type === 'folder-member') handleFolderMemberDrop(dt.folderId, dt.before);
                        else endDrag();
                      }}
                    >
                      {openMembers.map((m, mi) => {
                        const nextMember = openMembers[mi + 1];
                        const nextMemberId: string | 'end' = nextMember ? nextMember.id : 'end';
                        const showMemberIndicator = drag && dropTarget?.type === 'folder-member'
                          && dropTarget.folderId === folder.id && dropTarget.before === m.id;
                        return (
                          <div key={m.id} className="rail-member-wrap">
                            {showMemberIndicator ? <div className="rail-insert-indicator" /> : null}
                            {renderItem(m, folder.id, nextMemberId)}
                          </div>
                        );
                      })}
                      {drag && dropTarget?.type === 'folder-member' && dropTarget.folderId === folder.id && dropTarget.before === 'end'
                        ? <div className="rail-insert-indicator" /> : null}
                    </div>
                  </div>
                ) : (
                  <div className="messenger-rail-folder-wrap">
                    {renderFolder(folder, false, nextEntryId)}
                  </div>
                )}
              </div>
            );
          }

          const item = itemMap.get(entryId);
          if (!item) return null;
          return (
            <div key={item.id} className="rail-entry-wrap">
              {indicatorBefore(entryId) ? <div className="rail-insert-indicator" /> : null}
              {renderItem(item, undefined, nextEntryId)}
            </div>
          );
        })}
        {indicatorBefore('end') ? <div className="rail-insert-indicator" /> : null}
      </div>

      {tooltip ? createPortal(
        <div className="rail-folder-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.label}</div>,
        document.body
      ) : null}

      {menu ? createPortal(
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { setRenameTarget(menu.folder); setRenameDraft(menu.folder.name); setMenu(null); }}>
            {t(language, 'rename')}
          </button>
        </div>,
        document.body
      ) : null}

      {renameTarget ? createPortal(
        <div className="messenger-inline-modal rail-rename-modal" onClick={() => setRenameTarget(null)}>
          <div className="group-create-panel" onClick={(e) => e.stopPropagation()}>
            <h3>{t(language, 'renameFolder')}</h3>
            <input
              type="text"
              className="messenger-input"
              value={renameDraft}
              autoFocus
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenameTarget(null); }}
            />
            <div className="group-create-actions split">
              <button type="button" className="secondary-action" onClick={() => setRenameTarget(null)}>{t(language, 'cancel')}</button>
              <button type="button" className="primary-action" onClick={commitRename}>{t(language, 'save')}</button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
