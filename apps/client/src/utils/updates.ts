// =============================================================================
// NotOS update / changelog feed.
//
// HOW TO ADD A NEW UPDATE:
//   1. Add a new object to the TOP of the `UPDATES` array below (newest first).
//   2. Give it a unique `id` (e.g. bump the version or use a date like '2026-06-13').
//      The `id` is what tracks whether the user has already seen this update,
//      so it MUST be unique and must never be reused.
//   3. Fill in `version`, `date`, `title` and `summary` (one short line).
//   4. Put the full details in `body` (Markdown-ish plain text; line breaks are
//      preserved). Use blank lines to separate paragraphs.
//   5. (Optional) `headerImage` is the picture shown as the banner / "шапка" at
//      the top of the What's New window. Use an imported asset URL or a data URL.
//      If omitted, a default gradient banner is shown.
//
// The newest update id is exported as LATEST_UPDATE_ID. On login, the What's New
// window pops up automatically whenever LATEST_UPDATE_ID differs from the id the
// user last acknowledged (stored in localStorage). The desktop "Updates" shortcut
// always opens the full list.
// =============================================================================

export type AppUpdate = {
  /** Unique, never-reused identifier for this update. */
  id: string;
  /** Display version, e.g. '1.1.0'. */
  version: string;
  /** ISO date (YYYY-MM-DD) the update was released. */
  date: string;
  /** Short headline shown on the update button and at the top of the details. */
  title: string;
  /** One-line summary shown under the title in the list. */
  summary: string;
  /** Full details. Plain text; blank lines separate paragraphs. */
  body: string;
  /** Optional banner image (asset URL or data URL) shown as the window header. */
  headerImage?: string;
};

// Newest update first.
export const UPDATES: AppUpdate[] = [
  {
    id: '2026-06-13-ui-fixes',
    version: '1.1.0',
    date: '2026-06-13',
    title: 'Quality-of-life update',
    summary: 'Pinned cards, shortcut renaming, smoother dragging and a new What\'s New center.',
    body: [
      'This release focuses on desktop polish and a brand new updates center.',
      'Pinned image cards now keep their place when you resize the window.',
      'Desktop shortcuts can be renamed inline (file extensions are protected), long names are trimmed, and dragging no longer snaps back.',
      'You can now open "Edit profile" straight from your profile card and the embed.',
      'Removing a friend now asks for confirmation first.',
      'The messenger header shows where you are: a tab name, or the avatar and name of the chat / server you opened.'
    ].join('\n\n')
  }
];

export const LATEST_UPDATE_ID = UPDATES[0]?.id ?? '';

const SEEN_UPDATE_KEY = 'notoc.updates.seen';

export function getLastSeenUpdateId(): string | null {
  try {
    return localStorage.getItem(SEEN_UPDATE_KEY);
  } catch {
    return null;
  }
}

export function markUpdatesSeen(id: string = LATEST_UPDATE_ID): void {
  try {
    localStorage.setItem(SEEN_UPDATE_KEY, id);
  } catch {
    // ignore storage errors
  }
}

/** Whether the auto-popup should be shown (a newer update than last seen). */
export function hasUnseenUpdate(): boolean {
  if (!LATEST_UPDATE_ID) return false;
  return getLastSeenUpdateId() !== LATEST_UPDATE_ID;
}
