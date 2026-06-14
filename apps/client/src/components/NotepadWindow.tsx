import { useEffect, useMemo, useRef, useState } from 'react';
import type { Language, StorageItem } from '../api/types';
import { t } from '../i18n';
import { WindowFrame } from './WindowFrame';

type NotepadWindowProps = {
  token: string;
  language: Language;
  itemId: string;
  items: StorageItem[];
  maximized: boolean;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onTitleChange: (title: string) => void;
  onSaveItems: (items: StorageItem[]) => Promise<void>;
};

function now() {
  return new Date().toISOString();
}

type NotepadMenu = 'file' | 'edit' | 'format' | 'view' | 'help';

export function NotepadWindow({ language, itemId, items, maximized, zIndex, onFocus, onClose, onMinimize, onToggleMaximize, onTitleChange, onSaveItems }: NotepadWindowProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeMenu, setActiveMenu] = useState<NotepadMenu | null>(null);
  const [wordWrap, setWordWrap] = useState(true);
  const [fontScale, setFontScale] = useState(14);

  const item = useMemo(() => items.find((candidate) => candidate.id === itemId && candidate.type === 'text') ?? null, [itemId, items]);
  const title = item?.name ?? t(language, 'notepad');

  useEffect(() => {
    onTitleChange(title);
  }, [onTitleChange, title]);

  useEffect(() => {
    setDraft(item?.content ?? '');
    setError('');
  }, [item?.content, itemId]);

  async function save() {
    if (!item) return;
    setSaving(true);
    setError('');
    const timestamp = now();
    const nextItems = items.map((candidate) =>
      candidate.id === item.id ? { ...candidate, content: draft, updatedAt: timestamp } : candidate
    );

    try {
      await onSaveItems(nextItems);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t(language, 'unknownError'));
    } finally {
      setSaving(false);
    }
  }

  function focusEditor() {
    textareaRef.current?.focus();
  }

  function runEditCommand(command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste') {
    focusEditor();
    document.execCommand(command);
    setActiveMenu(null);
  }

  function selectAll() {
    textareaRef.current?.select();
    setActiveMenu(null);
  }

  function menuButton(id: NotepadMenu, label: string) {
    return (
      <button className={activeMenu === id ? 'notepad-menu-button active' : 'notepad-menu-button'} type="button" onClick={() => setActiveMenu((current) => (current === id ? null : id))}>
        {label}
      </button>
    );
  }

  return (
    <WindowFrame
      language={language}
      title={title}
      eyebrow={t(language, 'notepad')}
      className="notepad-window"
      maximized={maximized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(42, window.innerWidth / 2 - 330), y: 96 }}
      storageKey="notepad"
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div className="notepad-menu-bar" onMouseLeave={() => setActiveMenu(null)}>
        {menuButton('file', t(language, 'notepadFile'))}
        {menuButton('edit', t(language, 'notepadEdit'))}
        {menuButton('format', t(language, 'notepadFormat'))}
        {menuButton('view', t(language, 'view'))}
        {menuButton('help', t(language, 'notepadHelp'))}

        {activeMenu ? (
          <div className="notepad-menu-dropdown">
            {activeMenu === 'file' ? (
              <>
                <button type="button" disabled={!item || saving} onClick={() => void save().then(() => setActiveMenu(null))}>{saving ? t(language, 'saving') : t(language, 'save')}</button>
                <button type="button" onClick={onClose}>{t(language, 'close')}</button>
              </>
            ) : null}
            {activeMenu === 'edit' ? (
              <>
                <button type="button" onClick={() => runEditCommand('undo')}>{t(language, 'undo')}</button>
                <button type="button" onClick={() => runEditCommand('redo')}>{t(language, 'redo')}</button>
                <button type="button" onClick={() => runEditCommand('cut')}>{t(language, 'cut')}</button>
                <button type="button" onClick={() => runEditCommand('copy')}>{t(language, 'copy')}</button>
                <button type="button" onClick={() => runEditCommand('paste')}>{t(language, 'paste')}</button>
                <button type="button" onClick={selectAll}>{t(language, 'selectAll')}</button>
              </>
            ) : null}
            {activeMenu === 'format' ? (
              <>
                <button type="button" onClick={() => setWordWrap((value) => !value)}>{wordWrap ? '✓ ' : ''}{t(language, 'wordWrap')}</button>
                <button type="button" onClick={() => setFontScale(14)}>{t(language, 'defaultFont')}</button>
                <button type="button" onClick={() => setFontScale(15)}>{t(language, 'largerFont')}</button>
              </>
            ) : null}
            {activeMenu === 'view' ? (
              <>
                <button type="button" onClick={() => setFontScale((value) => Math.min(22, value + 1))}>{t(language, 'zoomIn')}</button>
                <button type="button" onClick={() => setFontScale((value) => Math.max(11, value - 1))}>{t(language, 'zoomOut')}</button>
              </>
            ) : null}
            {activeMenu === 'help' ? (
              <button type="button" onClick={() => window.alert('NotOS Notepad')}>{t(language, 'aboutNotepad')}</button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <textarea
        ref={textareaRef}
        className="notepad-editor"
        style={{ fontSize: fontScale, whiteSpace: wordWrap ? 'pre-wrap' : 'pre' }}
        value={draft}
        disabled={!item}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="notepad-statusbar">
        <span>{title}</span>
        <span>{saving ? t(language, 'saving') : `UTF-8 | ${fontScale}px`}</span>
      </div>
    </WindowFrame>
  );
}
