// Compact OpenGraph card rendered under a message whose body contains a URL.
// The preview data is fetched and sanitized server-side; clicking opens the
// link in the system browser.
import type { LinkPreview } from '../api/types';
import { openExternalUrl } from '../utils/external-url';

export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  return (
    <button
      type="button"
      className="link-preview-card"
      onClick={(event) => {
        event.stopPropagation();
        openExternalUrl(preview.url);
      }}
      title={preview.url}
    >
      <span className="link-preview-text">
        <small className="link-preview-site">{preview.siteName}</small>
        <strong className="link-preview-title">{preview.title}</strong>
        {preview.description ? <span className="link-preview-description">{preview.description}</span> : null}
      </span>
      {preview.imageUrl ? (
        <img className="link-preview-image" src={preview.imageUrl} alt="" loading="lazy" draggable={false} />
      ) : null}
    </button>
  );
}
