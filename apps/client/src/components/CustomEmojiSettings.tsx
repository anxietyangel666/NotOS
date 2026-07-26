import { useEffect, useMemo, useState } from 'react';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import {
  fetchEmojiGgPacks,
  fetchEmojiGgCategories,
  fetchEmojiGgCategoryEmojis,
  searchEmojiGgEmojis,
  getInstalledPacks,
  installPack,
  removePack,
  createCustomPack,
  renamePack,
  addEmojiToPack,
  removeEmojiFromPack,
  subscribeCustomEmoji,
  buildPackLink,
  mirrorCustomEmojiUrl,
  type CustomEmoji,
  type CustomEmojiPack,
  type EmojiGgCategory
} from '../utils/custom-emoji';

type Mode = 'browse' | 'mine';

// Settings panel for managing custom emoji: browse/install emoji.gg packs, and
// build your own named packs (add emojis from the emoji.gg catalog or by URL).
export function CustomEmojiSettings({ language, currentUser }: { language: Language; currentUser: PublicUser }) {
  const [mode, setMode] = useState<Mode>('browse');
  const [installed, setInstalled] = useState<CustomEmojiPack[]>(() => getInstalledPacks());

  useEffect(() => subscribeCustomEmoji(() => setInstalled(getInstalledPacks())), []);

  return (
    <section className="settings-section custom-emoji-settings">
      <h3>{t(language, 'customEmojiSettingsTitle')}</h3>
      <p className="settings-hint">{t(language, 'customEmojiSettingsHint')}</p>

      <div className="picker-tabs settings-mode-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'browse'} className={mode === 'browse' ? 'active' : ''} onClick={() => setMode('browse')}>
          {t(language, 'customEmojiBrowse')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'mine'} className={mode === 'mine' ? 'active' : ''} onClick={() => setMode('mine')}>
          {t(language, 'customEmojiMine')}
        </button>
      </div>

      {mode === 'browse' ? <BrowsePanel language={language} installed={installed} /> : <MyPacksPanel language={language} installed={installed} currentUser={currentUser} />}
    </section>
  );
}

// How many page numbers to show at once. This is a visible-window size, not a
// hard cap on reachable pages: 1..10 slides to 2..11, 3..12, and so on.
const MAX_VISIBLE_PAGES = 10;

function createSlidingPager(page: number, hasMore: boolean, knownLastPage: number | null = null) {
  const lastVisiblePage = knownLastPage ?? (hasMore ? Math.max(MAX_VISIBLE_PAGES, page + 1) : page);
  const visibleCount = Math.min(MAX_VISIBLE_PAGES, lastVisiblePage);
  const maxStart = Math.max(1, lastVisiblePage - visibleCount + 1);
  const preferredStart = page >= MAX_VISIBLE_PAGES ? page - MAX_VISIBLE_PAGES + 2 : 1;
  const start = Math.min(Math.max(1, preferredStart), maxStart);
  const pageNumbers = Array.from({ length: visibleCount }, (_, index) => start + index)
    .filter((pageNumber) => pageNumber <= lastVisiblePage);

  return {
    pageNumbers,
    canGoNext: knownLastPage === null ? hasMore : page < knownLastPage
  };
}

// emoji.gg browser: curated packs, fetched lazily one site page at a time. The
// pager shows up to 10 page numbers at once and slides as the user moves
// forward. The search box queries the site's own pack search (/packs/<query>).
function BrowsePanel({ language, installed }: { language: Language; installed: CustomEmojiPack[] }) {
  const installedIds = useMemo(() => new Set(installed.map((pack) => pack.id)), [installed]);

  return (
    <div className="custom-emoji-browse">
      <BrowsePacks language={language} installedIds={installedIds} />
    </div>
  );
}

// Lazy, paged pack browser. The pager shows up to 10 page numbers straight away,
// but only the current page's packs are fetched (and then cached, keyed by
// query+page) so the tab loads fast. The search box runs through emoji.gg's own
// pack search so it covers every pack on the site, not just the ones loaded.
function BrowsePacks({ language, installedIds }: { language: Language; installedIds: Set<string> }) {
  const [pages, setPages] = useState<Record<string, CustomEmojiPack[]>>({});
  const [pageHasMore, setPageHasMore] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [knownLastPage, setKnownLastPage] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [query, setQuery] = useState('');
  // Debounced query actually used for fetching so typing does not spam the site.
  const [activeQuery, setActiveQuery] = useState('');

  // Debounce the search box.
  useEffect(() => {
    const timer = window.setTimeout(() => setActiveQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Reset paging whenever the search term changes.
  useEffect(() => {
    setPage(1);
    setKnownLastPage(null);
  }, [activeQuery]);

  const cacheKey = `${activeQuery}|${page}`;

  // Fetch the requested page if it is not cached yet.
  useEffect(() => {
    if (pages[cacheKey]) {
      setStatus('idle');
      return;
    }
    let alive = true;
    setStatus('loading');
    fetchEmojiGgPacks(page, activeQuery)
      .then((result) => {
        if (!alive) return;
        setPages((prev) => ({ ...prev, [cacheKey]: result.packs }));
        setPageHasMore((prev) => ({ ...prev, [cacheKey]: result.hasMore }));
        setKnownLastPage((current) => result.hasMore ? current : Math.min(current ?? page, page));
        setStatus('idle');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [cacheKey, page, activeQuery, pages]);

  const visiblePacks = pages[cacheKey] ?? [];
  const currentHasMore = knownLastPage === null ? (pageHasMore[cacheKey] ?? true) : page < knownLastPage;
  const pager = createSlidingPager(page, currentHasMore, knownLastPage);

  function goToPage(next: number) {
    setPage(next);
  }

  return (
    <>
      <input className="text-field" value={query} placeholder={t(language, 'customEmojiSearchPacks')} onChange={(event) => setQuery(event.target.value)} />

      {status === 'error' ? (
        <div className="gif-status">{t(language, 'customEmojiLoadError')}</div>
      ) : status === 'loading' && !pages[cacheKey] ? (
        <div className="gif-status">…</div>
      ) : visiblePacks.length === 0 ? (
        <div className="gif-status">{t(language, 'customEmojiNoResults')}</div>
      ) : (
        <div className="custom-emoji-pack-list">
          {visiblePacks.map((pack) => {
            const alreadyInstalled = installedIds.has(pack.id);
            return (
              <div className="custom-emoji-pack-card" key={pack.id}>
                <div className="custom-emoji-pack-card-head">
                  <strong>{pack.name} · {pack.emojis.length}</strong>
                  {alreadyInstalled ? (
                    <button type="button" className="secondary-action danger-text compact-action" onClick={() => removePack(pack.id)}>
                      {t(language, 'customEmojiRemove')}
                    </button>
                  ) : (
                    <button type="button" className="primary-action compact-action" onClick={() => installPack(pack)}>
                      {t(language, 'customEmojiInstall')}
                    </button>
                  )}
                </div>
                <div className="custom-emoji-grid">
                  {pack.emojis.slice(0, 24).map((emoji) => (
                    <img key={emoji.id} src={emoji.url} alt={`:${emoji.name}:`} title={`:${emoji.name}:`} width={28} height={28} loading="lazy" decoding="async" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pager.pageNumbers.length > 1 && status !== 'error' ? (
        <div className="custom-emoji-pager">
          <button type="button" className="compact-action" disabled={page <= 1} onClick={() => goToPage(Math.max(1, page - 1))}>‹</button>
          {pager.pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              className={pageNumber === page ? 'compact-action active' : 'compact-action'}
              aria-current={pageNumber === page}
              onClick={() => goToPage(pageNumber)}
            >
              {pageNumber}
            </button>
          ))}
          <button type="button" className="compact-action" disabled={!pager.canGoNext} onClick={() => goToPage(page + 1)}>›</button>
        </div>
      ) : null}
    </>
  );
}

// User-authored packs: create named packs and fill them with emojis searched or
// browsed straight from emoji.gg, or any image URL.
function MyPacksPanel({ language, installed, currentUser }: { language: Language; installed: CustomEmojiPack[]; currentUser: PublicUser }) {
  // Show every installed pack here: user-authored ones are fully editable,
  // emoji.gg packs installed from Browse are shown read-only (copy/remove only).
  const customPacks = installed.filter((pack) => pack.source === 'custom');
  const ggPacks = installed.filter((pack) => pack.source === 'emoji.gg');
  const [newPackName, setNewPackName] = useState('');
  const [categories, setCategories] = useState<EmojiGgCategory[]>([]);

  // Categories come from a static list (instant) and drive each pack's category
  // picker. Emoji search/browse is fetched per-pack on demand, so there is no
  // heavy catalog to load up front anymore.
  useEffect(() => {
    let alive = true;
    fetchEmojiGgCategories()
      .then((rows) => {
        if (alive) setCategories(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="custom-emoji-mine">
      <div className="custom-emoji-new-pack">
        <input className="text-field" value={newPackName} placeholder={t(language, 'customEmojiPackName')} onChange={(event) => setNewPackName(event.target.value)} />
        <button
          type="button"
          className="primary-action compact-action"
          disabled={!newPackName.trim()}
          onClick={() => {
            createCustomPack(newPackName);
            setNewPackName('');
          }}
        >
          {t(language, 'customEmojiCreatePack')}
        </button>
      </div>

      {customPacks.length === 0 && ggPacks.length === 0 ? (
        <div className="gif-status">{t(language, 'customEmojiEmpty')}</div>
      ) : (
        <>
          {customPacks.map((pack) => <EditablePack key={pack.id} language={language} pack={pack} categories={categories} currentUser={currentUser} />)}
          {ggPacks.map((pack) => <InstalledGgPack key={pack.id} language={language} pack={pack} currentUser={currentUser} />)}
        </>
      )}
    </div>
  );
}

// Read-only card for an emoji.gg pack installed from Browse. It cannot be edited
// (emojis come from the catalog), but it can be shared (Copy) and removed.
function InstalledGgPack({ language, pack, currentUser }: { language: Language; pack: CustomEmojiPack; currentUser: PublicUser }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const link = buildPackLink(pack, { id: currentUser.id, name: currentUser.nickname, avatar: currentUser.avatarData });
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const area = document.createElement('textarea');
      area.value = link;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="custom-emoji-pack-card">
      <div className="custom-emoji-pack-card-head">
        <strong>{pack.name} · {pack.emojis.length}</strong>
        <div className="custom-emoji-pack-card-buttons">
          <button type="button" className="secondary-action compact-action" onClick={() => void copyLink()}>
            {copied ? t(language, 'customEmojiLinkCopied') : t(language, 'customEmojiCopyLink')}
          </button>
          <button type="button" className="secondary-action danger-text compact-action" onClick={() => removePack(pack.id)}>
            {t(language, 'customEmojiRemove')}
          </button>
        </div>
      </div>
      <div className="custom-emoji-grid">
        {pack.emojis.slice(0, 24).map((emoji) => (
          <img key={emoji.id} src={emoji.url} alt={`:${emoji.name}:`} title={`:${emoji.name}:`} width={28} height={28} loading="lazy" decoding="async" />
        ))}
      </div>
    </div>
  );
}

// A single editable user pack: rename, delete, add by searching emoji.gg or by
// browsing a category (both straight through the website, paged lazily), or by
// any image URL.
function EditablePack({ language, pack, categories, currentUser }: { language: Language; pack: CustomEmojiPack; categories: EmojiGgCategory[]; currentUser: PublicUser }) {
  const [name, setName] = useState(pack.name);
  const [search, setSearch] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [category, setCategory] = useState('');
  const [url, setUrl] = useState('');
  const [shortcode, setShortcode] = useState('');
  const [copied, setCopied] = useState(false);

  // Live emoji results for adding, fetched from the site (search or category).
  const [matches, setMatches] = useState<CustomEmoji[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [knownLastPage, setKnownLastPage] = useState<number | null>(null);
  const [matchStatus, setMatchStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function copyLink() {
    const link = buildPackLink(pack, { id: currentUser.id, name: currentUser.nickname, avatar: currentUser.avatarData });
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for environments without the async clipboard API.
      const area = document.createElement('textarea');
      area.value = link;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  // Debounce the search box so typing does not hammer the site.
  useEffect(() => {
    const timer = window.setTimeout(() => setActiveQuery(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Reset paging when the query or category changes.
  useEffect(() => {
    setPage(1);
    setKnownLastPage(null);
  }, [activeQuery, category]);

  // Fetch the current page of add-candidates (search wins over category).
  useEffect(() => {
    if (!activeQuery && !category) {
      setMatches([]);
      setHasMore(false);
      setMatchStatus('idle');
      return;
    }
    let alive = true;
    setMatchStatus('loading');
    const request = activeQuery
      ? searchEmojiGgEmojis(activeQuery, page)
      : fetchEmojiGgCategoryEmojis(category, page);
    request
      .then((result) => {
        if (!alive) return;
        setMatches(result.emojis);
        setHasMore(result.hasMore);
        setKnownLastPage((current) => result.hasMore ? current : Math.min(current ?? page, page));
        setMatchStatus('idle');
      })
      .catch(() => {
        if (alive) setMatchStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [activeQuery, category, page]);

  const showResults = Boolean(activeQuery || category);
  const pager = createSlidingPager(page, knownLastPage === null ? hasMore : page < knownLastPage, knownLastPage);

  function goToPage(next: number) {
    setPage(next);
  }

  function addByUrl() {
    const trimmedUrl = url.trim();
    const code = (shortcode.trim() || 'emoji').replace(/[^a-z0-9_]/gi, '_');
    if (!/^https?:\/\//i.test(trimmedUrl)) return;
    addEmojiToPack(pack.id, { id: `url-${Date.now().toString(36)}`, name: code, url: mirrorCustomEmojiUrl(trimmedUrl) });
    setUrl('');
    setShortcode('');
  }

  return (
    <div className="custom-emoji-pack-card editable">
      <div className="custom-emoji-pack-card-head">
        <input
          className="text-field compact"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== pack.name) renamePack(pack.id, name);
          }}
        />
        <div className="custom-emoji-pack-card-buttons">
          <button type="button" className="secondary-action compact-action" onClick={() => void copyLink()}>
            {copied ? t(language, 'customEmojiLinkCopied') : t(language, 'customEmojiCopyLink')}
          </button>
          <button type="button" className="secondary-action danger-text compact-action" onClick={() => removePack(pack.id)}>
            {t(language, 'customEmojiRemove')}
          </button>
        </div>
      </div>

      <div className="custom-emoji-grid large">
        {pack.emojis.map((emoji) => (
          <button key={emoji.id} type="button" className="custom-emoji-remove-btn" title={`:${emoji.name}: — ${t(language, 'customEmojiRemove')}`} onClick={() => removeEmojiFromPack(pack.id, emoji.id)}>
            <img src={emoji.url} alt={`:${emoji.name}:`} width={56} height={56} loading="lazy" decoding="async" />
          </button>
        ))}
        {pack.emojis.length === 0 ? <span className="muted-line">{t(language, 'customEmojiAddTo')}</span> : null}
      </div>

      <div className="custom-emoji-pick-controls">
        {categories.length > 0 ? (
          <select className="text-field" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t(language, 'customEmojiAllCategories')}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        ) : null}
        <input className="text-field" value={search} placeholder={t(language, 'customEmojiSearchSite')} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {showResults ? (
        matchStatus === 'error' ? (
          <div className="gif-status">{t(language, 'customEmojiLoadError')}</div>
        ) : matchStatus === 'loading' ? (
          <div className="gif-status">…</div>
        ) : matches.length === 0 ? (
          <div className="gif-status">{t(language, 'customEmojiNoResults')}</div>
        ) : (
          <>
            <div className="custom-emoji-grid large suggestions">
              {matches.map((emoji) => {
                const inPack = pack.emojis.some((item) => item.name === emoji.name);
                return (
                  <button key={emoji.id} type="button" className={inPack ? 'custom-emoji-btn in-pack' : 'custom-emoji-btn'} title={`:${emoji.name}:`} onClick={() => addEmojiToPack(pack.id, emoji)}>
                    <img src={emoji.url} alt={`:${emoji.name}:`} width={56} height={56} loading="lazy" decoding="async" />
                  </button>
                );
              })}
            </div>
            {pager.pageNumbers.length > 1 ? (
              <div className="custom-emoji-pager">
                <button type="button" className="compact-action" disabled={page <= 1} onClick={() => goToPage(Math.max(1, page - 1))}>‹</button>
                {pager.pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    className={pageNumber === page ? 'compact-action active' : 'compact-action'}
                    aria-current={pageNumber === page}
                    onClick={() => goToPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button type="button" className="compact-action" disabled={!pager.canGoNext} onClick={() => goToPage(page + 1)}>›</button>
              </div>
            ) : null}
          </>
        )
      ) : null}

      <div className="custom-emoji-add-url">
        <input className="text-field" value={shortcode} placeholder={t(language, 'customEmojiNamePlaceholder')} onChange={(event) => setShortcode(event.target.value)} />
        <input className="text-field" value={url} placeholder={t(language, 'customEmojiUrlPlaceholder')} onChange={(event) => setUrl(event.target.value)} />
        <button type="button" className="secondary-action compact-action" disabled={!/^https?:\/\//i.test(url.trim())} onClick={addByUrl}>
          {t(language, 'customEmojiAddUrl')}
        </button>
      </div>
    </div>
  );
}
