import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ChangeEventHandler,
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent
} from 'react';
import {
  customEmojiShortcode,
  getInstalledPacks,
  subscribeCustomEmoji,
  type CustomEmoji
} from '../utils/custom-emoji';
import type { PublicUser } from '../api/types';
import { getAllEmojiItems } from '../utils/emoji-data';
import { expandCustomEmojiShortcodes, customEmojiToShortcodes, splitCustomEmoji } from '../utils/custom-emoji';

export type EmojiInlineInputHandle = {
  focus: () => void;
  insertText: (text: string) => void;
  replaceSelection: (text: string) => void;
  getSelection: () => { start: number; end: number };
  setSelection: (start: number, end?: number) => void;
};

type EmojiInlineInputProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'contentEditable' | 'dangerouslySetInnerHTML' | 'onChange'
> & {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  previewSize?: number;
  localValue?: boolean;
  syncKey?: number;
  mentionUsers?: Array<Pick<PublicUser, 'id' | 'nickname' | 'avatarData'>>;
  mentionRoles?: Array<{ id: string; name: string; color?: string }>;
  mentionEveryone?: boolean;
};

type Suggestion =
  | { key: string; kind: 'unicode'; name: string; emoji: string }
  | { key: string; kind: 'custom'; name: string; emoji: CustomEmoji }
  | { key: string; kind: 'mention'; name: string; user: Pick<PublicUser, 'id' | 'nickname' | 'avatarData'> }
  | { key: string; kind: 'role'; name: string; role: { id: string; name: string; color?: string } }
  | { key: string; kind: 'everyone'; name: string };

type ActiveQuery = { start: number; end: number; query: string; kind: 'emoji' | 'mention' };
type EditorPart = { type: 'text'; value: string } | { type: 'custom'; shortcode: string; name: string; url: string };
type SelectionOffsets = { start: number; end: number };

const STANDARD_EMOJI = getAllEmojiItems();
const CUSTOM_SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

function toEditorParts(value: string): EditorPart[] {
  const parts: EditorPart[] = [];
  let lastIndex = 0;
  CUSTOM_SHORTCODE_RE.lastIndex = 0;

  for (const match of value.matchAll(CUSTOM_SHORTCODE_RE)) {
    const start = match.index ?? 0;
    const shortcode = match[0];
    const expanded = expandCustomEmojiShortcodes(shortcode);
    const custom = splitCustomEmoji(expanded).find((part) => part.type === 'custom-emoji');
    if (!custom || custom.type !== 'custom-emoji') continue;

    if (start > lastIndex) parts.push({ type: 'text', value: value.slice(lastIndex, start) });
    parts.push({ type: 'custom', shortcode, name: custom.name, url: custom.url });
    lastIndex = start + shortcode.length;
  }

  if (lastIndex < value.length) parts.push({ type: 'text', value: value.slice(lastIndex) });
  return parts;
}

function textLengthOf(node: Node): number {
  if (node instanceof HTMLElement && node.dataset.emojiShortcode) return node.dataset.emojiShortcode.length;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  let length = 0;
  node.childNodes.forEach((child) => {
    length += textLengthOf(child);
  });
  return length;
}

function serializeEditor(root: HTMLElement): string {
  let value = '';
  root.childNodes.forEach((node) => {
    value += serializeNode(node);
  });
  return value;
}

function serializeNode(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.emojiShortcode) return node.dataset.emojiShortcode;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof HTMLBRElement) return '';
  let value = '';
  node.childNodes.forEach((child) => {
    value += serializeNode(child);
  });
  return value;
}

function offsetFromPosition(root: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(container, offset);
  } catch {
    range.detach();
    return serializeEditor(root).length;
  }

  const fragment = range.cloneContents();
  let length = 0;
  fragment.childNodes.forEach((node) => {
    length += textLengthOf(node);
  });
  range.detach();
  return length;
}

function readSelection(root: HTMLElement): SelectionOffsets {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    const end = serializeEditor(root).length;
    return { start: end, end };
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    const end = serializeEditor(root).length;
    return { start: end, end };
  }

  const start = offsetFromPosition(root, range.startContainer, range.startOffset);
  const end = offsetFromPosition(root, range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

function findPosition(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, targetOffset);

  function walk(parent: Node): { node: Node; offset: number } | null {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index];
      if (child instanceof HTMLElement && child.dataset.emojiShortcode) {
        const length = child.dataset.emojiShortcode.length;
        if (remaining <= 0) return { node: parent, offset: index };
        if (remaining < length) return { node: parent, offset: index + 1 };
        remaining -= length;
        continue;
      }

      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (remaining <= length) return { node: child, offset: remaining };
        remaining -= length;
        continue;
      }

      const nested = walk(child);
      if (nested) return nested;
    }
    return null;
  }

  return walk(root) ?? { node: root, offset: root.childNodes.length };
}

function restoreSelection(root: HTMLElement, start: number, end = start) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const startPos = findPosition(root, start);
  const endPos = findPosition(root, end);
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function renderEditorDom(root: HTMLElement, parts: EditorPart[], size: number) {
  root.replaceChildren();

  for (const part of parts) {
    if (part.type === 'text') {
      root.appendChild(document.createTextNode(part.value));
      continue;
    }

    const token = document.createElement('span');
    token.className = 'emoji-inline-custom-token';
    token.dataset.emojiShortcode = part.shortcode;
    token.contentEditable = 'false';
    token.title = part.shortcode;

    const image = document.createElement('img');
    image.src = part.url;
    image.alt = part.shortcode;
    image.draggable = false;
    image.width = size;
    image.height = size;

    const hidden = document.createElement('span');
    hidden.className = 'emoji-inline-token-text';
    hidden.textContent = part.shortcode;

    token.append(image, hidden);
    root.appendChild(token);
  }
}

function findActiveQuery(value: string, caret: number | null, mentionEnabled = false): ActiveQuery | null {
  if (caret === null) return null;
  const before = value.slice(0, caret);
  const match = before.match(/(?:^|\s):([a-z0-9_+-]{1,40}):?$/i);
  if (match) {
    const colonOffset = match[0].lastIndexOf(':');
    return {
      start: before.length - match[0].length + colonOffset,
      end: caret,
      query: match[1].toLowerCase(),
      kind: 'emoji'
    };
  }
  if (!mentionEnabled) return null;
  const mentionMatch = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]{0,24})$/u);
  if (!mentionMatch) return null;
  const atOffset = mentionMatch[0].lastIndexOf('@');
  return {
    start: before.length - mentionMatch[0].length + atOffset,
    end: caret,
    query: mentionMatch[1].toLowerCase(),
    kind: 'mention'
  };
}

function scoreName(name: string, query: string) {
  const normalized = name.toLowerCase().replace(/\s+/g, '_');
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 2;
  return 99;
}

function mentionReplacement(value: string) {
  return `@${value.trim().replace(/\s+/g, '_')}`;
}

export const EmojiInlineInput = forwardRef<EmojiInlineInputHandle, EmojiInlineInputProps>(function EmojiInlineInput(
  { value, onChange, onKeyDown, onBlur, onFocus, onClick, onKeyUp, onPaste, className, previewSize: _previewSize = 18, localValue = false, syncKey = 0, placeholder, maxLength, disabled = false, mentionUsers = [], mentionRoles = [], mentionEveryone = false, ...props },
  ref
) {
  const [innerValue, setInnerValue] = useState(value);
  const [activeQuery, setActiveQuery] = useState<ActiveQuery | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customVersion, setCustomVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<SelectionOffsets>({ start: 0, end: 0 });
  const pendingSelectionRef = useRef<SelectionOffsets | null>(null);
  const rawValue = localValue ? innerValue : value;
  const displayValue = customEmojiToShortcodes(rawValue);
  const editorParts = useMemo(() => toEditorParts(displayValue), [displayValue, customVersion]);
  const mentionList = useMemo(() => Array.from(new Map(mentionUsers.map((person) => [person.id, person])).values()), [mentionUsers]);
  const roleMentionList = useMemo(() => Array.from(new Map(mentionRoles.map((role) => [role.id, role])).values()), [mentionRoles]);
  const mentionEnabled = mentionList.length > 0 || roleMentionList.length > 0 || mentionEveryone;

  useEffect(() => {
    if (!localValue) return;
    setInnerValue(value);
    const end = customEmojiToShortcodes(value).length;
    pendingSelectionRef.current = { start: end, end };
  }, [localValue, value, syncKey]);

  useEffect(() => subscribeCustomEmoji(() => setCustomVersion((version) => version + 1)), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const focused = document.activeElement === root;
    const pending = pendingSelectionRef.current ?? (focused ? readSelection(root) : null);
    renderEditorDom(root, editorParts, _previewSize);
    if (!pending || !focused) return;
    const bounded = {
      start: Math.min(pending.start, displayValue.length),
      end: Math.min(pending.end, displayValue.length)
    };
    restoreSelection(root, bounded.start, bounded.end);
    selectionRef.current = bounded;
    pendingSelectionRef.current = null;
  }, [displayValue, editorParts, _previewSize]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!activeQuery) return [];
    const query = activeQuery.query;
    if (activeQuery.kind === 'mention') {
      const users = mentionList
        .map((user) => ({
          key: `mention:${user.id}`,
          kind: 'mention' as const,
          name: user.nickname,
          user,
          score: scoreName(user.nickname, query)
        }))
        .filter((item) => query.length === 0 || item.score < 99)
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
        .map(({ score: _score, ...item }) => item);
      const roles = roleMentionList
        .map((role) => ({
          key: `role:${role.id}`,
          kind: 'role' as const,
          name: role.name,
          role,
          score: scoreName(role.name, query)
        }))
        .filter((item) => query.length === 0 || item.score < 99)
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
        .map(({ score: _score, ...item }) => item);
      const everyone = mentionEveryone && ('everyone'.startsWith(query) || query.length === 0)
        ? [{ key: 'everyone', kind: 'everyone' as const, name: 'everyone' }]
        : [];
      return [...everyone, ...roles, ...users].slice(0, 8);
    }
    const custom = getInstalledPacks()
      .flatMap((pack) => pack.emojis)
      .map((emoji) => ({
        key: `custom:${emoji.id}`,
        kind: 'custom' as const,
        name: emoji.name,
        emoji,
        score: scoreName(emoji.name, query)
      }))
      .filter((item) => item.score < 99);
    const unicode = STANDARD_EMOJI
      .map((item) => ({
        key: `unicode:${item.id}:${item.emoji}`,
        kind: 'unicode' as const,
        name: item.name,
        emoji: item.emoji,
        score: Math.min(scoreName(item.name, query), scoreName(item.id, query))
      }))
      .filter((item) => item.score < 99);
    return [...custom, ...unicode]
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map(({ score: _score, ...item }) => item);
  }, [activeQuery, customVersion, mentionEveryone, mentionList, roleMentionList]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeQuery?.kind, activeQuery?.query]);

  function emitValue(next: string) {
    if (localValue) setInnerValue(next);
    const synthetic = {
      target: { value: next },
      currentTarget: { value: next }
    } as unknown as ChangeEvent<HTMLInputElement>;
    onChange(synthetic);
  }

  function updateSelectionFromDom() {
    const root = rootRef.current;
    if (!root) return selectionRef.current;
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return selectionRef.current;
    const range = domSelection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return selectionRef.current;
    const selection = readSelection(root);
    selectionRef.current = selection;
    return selection;
  }

  function replaceRange(start: number, end: number, text: string) {
    const before = displayValue.slice(0, start);
    const after = displayValue.slice(end);
    const nextRaw = `${before}${text}${after}`;
    const next = typeof maxLength === 'number' ? nextRaw.slice(0, maxLength) : nextRaw;
    const caret = start + text.length;
    const boundedCaret = Math.min(caret, next.length);
    pendingSelectionRef.current = { start: boundedCaret, end: boundedCaret };
    selectionRef.current = { start: boundedCaret, end: boundedCaret };
    emitValue(next);
    setActiveQuery(findActiveQuery(next, boundedCaret, mentionEnabled));
    window.requestAnimationFrame(() => {
      rootRef.current?.focus();
      if (rootRef.current) restoreSelection(rootRef.current, boundedCaret);
    });
  }

  useImperativeHandle(ref, () => ({
    focus() {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      window.requestAnimationFrame(() => {
        const selection = selectionRef.current.start === 0 && selectionRef.current.end === 0 && displayValue.length > 0
          ? { start: displayValue.length, end: displayValue.length }
          : selectionRef.current;
        restoreSelection(root, selection.start, selection.end);
      });
    },
    insertText(text: string) {
      const selection = selectionRef.current;
      replaceRange(selection.start, selection.end, text);
    },
    replaceSelection(text: string) {
      const selection = selectionRef.current;
      replaceRange(selection.start, selection.end, text);
    },
    getSelection() {
      const root = rootRef.current;
      return root && document.activeElement === root ? updateSelectionFromDom() : selectionRef.current;
    },
    setSelection(start: number, end = start) {
      const next = { start, end };
      selectionRef.current = next;
      pendingSelectionRef.current = next;
      window.requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        root.focus();
        restoreSelection(root, start, end);
      });
    }
  }), [displayValue]);

  function refreshQuery() {
    const selection = updateSelectionFromDom();
    setActiveQuery(findActiveQuery(displayValue, selection.end, mentionEnabled));
  }

  function chooseSuggestion(suggestion: Suggestion) {
    if (!activeQuery) return;
    const replacement = suggestion.kind === 'custom'
      ? customEmojiShortcode(suggestion.emoji)
      : suggestion.kind === 'mention'
        ? mentionReplacement(suggestion.user.nickname)
        : suggestion.kind === 'role'
          ? mentionReplacement(suggestion.role.name)
          : suggestion.kind === 'everyone'
            ? '@everyone'
            : suggestion.emoji;
    const after = displayValue.slice(activeQuery.end).replace(/^ +/, '');
    const next = `${displayValue.slice(0, activeQuery.start)}${replacement} ${after}`;
    const caret = activeQuery.start + replacement.length + 1;
    pendingSelectionRef.current = { start: caret, end: caret };
    selectionRef.current = { start: caret, end: caret };
    emitValue(next);
    setActiveQuery(null);
    window.requestAnimationFrame(() => {
      rootRef.current?.focus();
      if (rootRef.current) restoreSelection(rootRef.current, caret);
    });
  }

  function handleInput() {
    const root = rootRef.current;
    if (!root) return;
    const selection = readSelection(root);
    const serialized = serializeEditor(root);
    const next = typeof maxLength === 'number' ? serialized.slice(0, maxLength) : serialized;
    const boundedSelection = {
      start: Math.min(selection.start, next.length),
      end: Math.min(selection.end, next.length)
    };
    selectionRef.current = boundedSelection;
    pendingSelectionRef.current = boundedSelection;
    emitValue(next);
    setActiveQuery(findActiveQuery(next, boundedSelection.end, mentionEnabled));
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    const selection = updateSelectionFromDom();
    replaceRange(selection.start, selection.end, text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        chooseSuggestion(suggestions[selectedIndex] ?? suggestions[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveQuery(null);
        return;
      }
    }

    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      rootRef.current?.closest('form')?.requestSubmit();
    }
  }

  const isEmpty = displayValue.length === 0;

  return (
    <span className="emoji-inline-field">
      <div
        {...props}
        ref={rootRef}
        className={className ? `${className} emoji-inline-native` : 'emoji-inline-native'}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role={props.role ?? 'textbox'}
        aria-multiline="false"
        aria-disabled={disabled || undefined}
        aria-label={props['aria-label'] ?? (typeof placeholder === 'string' ? placeholder : undefined)}
        data-placeholder={placeholder}
        data-empty={isEmpty ? 'true' : 'false'}
        spellCheck={props.spellCheck ?? true}
        onInput={handleInput}
        onPaste={handlePaste}
        onClick={(event) => {
          updateSelectionFromDom();
          refreshQuery();
          onClick?.(event);
        }}
        onKeyUp={(event) => {
          updateSelectionFromDom();
          refreshQuery();
          onKeyUp?.(event);
        }}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          updateSelectionFromDom();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          updateSelectionFromDom();
          window.setTimeout(() => setActiveQuery(null), 120);
          onBlur?.(event);
        }}
      />
      {activeQuery && suggestions.length > 0 ? (
        <div className="emoji-shortcode-menu" role="listbox">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.key}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? 'active' : ''}
              onMouseDown={(event) => {
                event.preventDefault();
                chooseSuggestion(suggestion);
              }}
            >
              {suggestion.kind === 'custom'
                ? <img src={suggestion.emoji.url} alt="" draggable={false} />
                : suggestion.kind === 'mention'
                  ? <img className="emoji-shortcode-avatar" src={suggestion.user.avatarData} alt="" draggable={false} />
                  : suggestion.kind === 'role'
                    ? <span className="emoji-shortcode-role" style={{ backgroundColor: suggestion.role.color ?? 'var(--blue)' }}>@</span>
                    : suggestion.kind === 'everyone'
                      ? <span className="emoji-shortcode-role everyone">@</span>
                  : <span className="emoji-shortcode-unicode">{suggestion.emoji}</span>}
              <span>{suggestion.kind === 'mention' || suggestion.kind === 'role' || suggestion.kind === 'everyone' ? mentionReplacement(suggestion.name) : `:${suggestion.name.replace(/\s+/g, '_')}:`}</span>
              <small>{suggestion.kind === 'custom' ? 'Custom' : suggestion.kind === 'mention' ? 'User' : suggestion.kind === 'role' ? 'Role' : suggestion.kind === 'everyone' ? 'Everyone' : 'Emoji'}</small>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
});
