/**
 * DesktopIcons — memoized desktop icon grid.
 *
 * Previously inlined in Desktop.tsx and re-rendered on every mouse move
 * (dragDelta updates at 60 fps while dragging). Now only re-renders when
 * icon positions, selection, or drag state actually change.
 */
import { memo, type MouseEvent } from 'react';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';

type DesktopIconMeta = {
  id: string;
  letters: string;
  label: string;
  iconType: string;
  badgeCount?: number;
};

type IconDragState = {
  ids: string[];
  startX: number;
  startY: number;
  basePositions: Record<string, { x: number; y: number }>;
  moved: boolean;
};

type DesktopIconsProps = {
  language: Language;
  user: PublicUser;
  desktopIcons: DesktopIconMeta[];
  iconPositions: PublicUser['desktopIcons'];
  iconMetrics: { width: number; height: number; gap: number };
  selectedIconIds: string[];
  renamingIconId: string | null;
  renameDraft: string;
  dragState: IconDragState | null;
  dragDelta: { x: number; y: number };
  onMouseDown: (event: MouseEvent<HTMLButtonElement>, iconId: string) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, iconId: string) => void;
  onDoubleClick: (iconId: string) => void;
  onRenameDraftChange?: (value: string) => void;
  onRenameCommit?: (iconId: string) => void;
  onRenameCancel?: () => void;
};

export const DesktopIcons = memo(function DesktopIcons({
  language,
  user,
  desktopIcons,
  iconPositions,
  selectedIconIds,
  renamingIconId,
  renameDraft,
  dragState,
  dragDelta,
  onMouseDown,
  onContextMenu,
  onDoubleClick,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel
}: DesktopIconsProps) {
  return (
    <section
      className={`${dragState?.moved ? 'desktop-icons dragging' : 'desktop-icons'} icon-size-${user.desktopIconSize}`}
      aria-label={t(language, 'desktopSettings')}
      hidden={user.hideDesktopIcons}
    >
      {!user.hideDesktopIcons && desktopIcons.map((icon) => (
        <button
          key={icon.id}
          className={selectedIconIds.includes(icon.id) ? 'desktop-tile selected' : 'desktop-tile'}
          style={{
            left: iconPositions[icon.id].x,
            top: iconPositions[icon.id].y,
            transform: dragState?.ids.includes(icon.id)
              ? `translate3d(${dragDelta.x}px, ${dragDelta.y}px, 0)`
              : undefined
          }}
          type="button"
          draggable={false}
          data-dragging={dragState?.ids.includes(icon.id) ? 'true' : undefined}
          onDragStart={(event) => event.preventDefault()}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            onMouseDown(event, icon.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onContextMenu(event, icon.id);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onDoubleClick(icon.id);
          }}
        >
          <span className={`tile-icon tile-icon-${icon.iconType}`}>{icon.letters}</span>
          {icon.badgeCount && icon.badgeCount > 0 ? (
            <span className="unread-badge desktop-icon-badge">{icon.badgeCount > 9 ? '9+' : icon.badgeCount}</span>
          ) : null}
          {renamingIconId === icon.id && onRenameDraftChange && onRenameCommit && onRenameCancel ? (
            <input
              className="desktop-tile-rename"
              autoFocus
              value={renameDraft}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onBlur={() => onRenameCommit(icon.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onRenameCommit(icon.id);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  onRenameCancel();
                }
              }}
            />
          ) : (
            <span
              className={
                selectedIconIds.length === 1 && selectedIconIds[0] === icon.id
                  ? 'tile-label expanded'
                  : 'tile-label'
              }
              title={icon.label}
            >
              {icon.label}
            </span>
          )}
        </button>
      ))}
    </section>
  );
});
