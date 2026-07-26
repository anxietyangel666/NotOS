export function openExternalUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    const normalized = parsed.toString();
    if (window.notoc?.openExternal) {
      void window.notoc.openExternal(normalized);
      return;
    }
    if (!window.notoc) {
      window.open(normalized, '_blank', 'noopener,noreferrer');
    }
  } catch {
    // Ignore malformed URLs.
  }
}
