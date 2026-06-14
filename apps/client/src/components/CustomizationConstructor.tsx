import { useState } from 'react';
import { api } from '../api/client';
import type { CustomCategory, GroupChannel, Language } from '../api/types';
import { t } from '../i18n';
import { Twemoji } from './Twemoji';

type CustomizationConstructorProps = {
  token: string;
  language: Language;
  groupId: string;
  categories: CustomCategory[];
  channels: GroupChannel[];
  onCategoriesChange: (categories: CustomCategory[]) => void;
};

// Admin "Customization" constructor. Lets owners/role-managers define
// categories ("Hobby", "Faction"), their selection type, hidden-channel and
// onboarding flags, and the options inside each (which back auto-created roles).
export function CustomizationConstructor({
  token,
  language,
  groupId,
  categories,
  channels,
  onCategoriesChange
}: CustomizationConstructorProps) {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSelectionType, setNewSelectionType] = useState<'multi' | 'single'>('multi');
  const [newHideChannels, setNewHideChannels] = useState(false);
  const [newRequired, setNewRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-category draft state for adding an option.
  const [optionDrafts, setOptionDrafts] = useState<Record<string, { label: string; emoji: string; color: string }>>({});

  function optionDraft(categoryId: string) {
    return optionDrafts[categoryId] ?? { label: '', emoji: '', color: '#8a8a8a' };
  }
  function setOptionDraft(categoryId: string, patch: Partial<{ label: string; emoji: string; color: string }>) {
    setOptionDrafts((current) => ({
      ...current,
      [categoryId]: { ...optionDraft(categoryId), ...patch }
    }));
  }

  async function run(action: () => Promise<{ categories: CustomCategory[] }>) {
    setBusy(true);
    setError(null);
    try {
      const { categories: next } = await action();
      onCategoriesChange(next);
    } catch {
      setError(t(language, 'customizeError'));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    await run(() => api.createCustomCategory(token, groupId, {
      name,
      selectionType: newSelectionType,
      hideChannels: newHideChannels,
      required: newRequired
    }));
    setNewCategoryName('');
    setNewSelectionType('multi');
    setNewHideChannels(false);
    setNewRequired(false);
  }

  async function handleAddOption(categoryId: string) {
    const draft = optionDraft(categoryId);
    const label = draft.label.trim();
    if (!label) return;
    await run(() => api.createCustomOption(token, groupId, categoryId, {
      label,
      emoji: draft.emoji.trim() || undefined,
      color: draft.color
    }));
    setOptionDrafts((current) => ({ ...current, [categoryId]: { label: '', emoji: '', color: '#8a8a8a' } }));
  }

  return (
    <div className="group-settings-section customization-constructor">
      <h3>{t(language, 'customization')}</h3>
      <p className="customization-hint">{t(language, 'customizeAdminHint')}</p>

      {/* Existing categories */}
      <div className="customization-cat-list">
        {categories.map((category) => (
          <div key={category.id} className="customization-cat-card">
            <div className="customization-cat-card-head">
              <input
                className="messenger-input customization-cat-name"
                value={category.name}
                onChange={(e) => onCategoriesChange(categories.map((c) => c.id === category.id ? { ...c, name: e.target.value } : c))}
                onBlur={(e) => void run(() => api.updateCustomCategory(token, groupId, category.id, { name: e.target.value.trim() || category.name }))}
              />
              <select
                className="messenger-input customization-cat-type"
                value={category.selectionType}
                onChange={(e) => void run(() => api.updateCustomCategory(token, groupId, category.id, { selectionType: e.target.value as 'multi' | 'single' }))}
              >
                <option value="multi">{t(language, 'selectMany')}</option>
                <option value="single">{t(language, 'selectOne')}</option>
              </select>
              <button
                type="button"
                className="customization-cat-delete"
                title={t(language, 'delete')}
                disabled={busy}
                onClick={() => void run(() => api.deleteCustomCategory(token, groupId, category.id))}
              >✕</button>
            </div>

            <div className="customization-cat-toggles">
              <label className="customization-checkbox">
                <input
                  type="checkbox"
                  checked={category.hideChannels}
                  onChange={(e) => void run(() => api.updateCustomCategory(token, groupId, category.id, { hideChannels: e.target.checked }))}
                />
                <span>{t(language, 'hideChannelsByRole')}</span>
              </label>
              <label className="customization-checkbox">
                <input
                  type="checkbox"
                  checked={category.required}
                  onChange={(e) => void run(() => api.updateCustomCategory(token, groupId, category.id, { required: e.target.checked }))}
                />
                <span>{t(language, 'requiredOnJoin')}</span>
              </label>
            </div>

            {/* Options */}
            <div className="customization-opt-list">
              {category.options.map((option) => (
                <div key={option.id} className="customization-opt-row">
                  <span className="group-settings-role-dot" style={{ backgroundColor: option.color }} />
                  {option.emoji ? <span className="customization-opt-emoji"><Twemoji emoji={option.emoji} /></span> : null}
                  <span className="customization-opt-label">{option.label}</span>
                  {category.hideChannels && option.folderId ? (
                    <ChannelGate
                      token={token}
                      language={language}
                      groupId={groupId}
                      option={option}
                      channels={channels}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="customization-opt-delete"
                    title={t(language, 'delete')}
                    disabled={busy}
                    onClick={() => void run(() => api.deleteCustomOption(token, groupId, option.id))}
                  >✕</button>
                </div>
              ))}

              {/* Add option row */}
              <div className="customization-opt-add">
                <input
                  type="text"
                  className="messenger-input customization-opt-emoji-input"
                  placeholder="🎨"
                  maxLength={8}
                  value={optionDraft(category.id).emoji}
                  onChange={(e) => setOptionDraft(category.id, { emoji: e.target.value })}
                />
                <input
                  type="color"
                  className="customization-opt-color"
                  value={optionDraft(category.id).color}
                  onChange={(e) => setOptionDraft(category.id, { color: e.target.value })}
                />
                <input
                  type="text"
                  className="messenger-input customization-opt-name-input"
                  placeholder={t(language, 'optionLabel')}
                  maxLength={60}
                  value={optionDraft(category.id).label}
                  onChange={(e) => setOptionDraft(category.id, { label: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleAddOption(category.id); }}
                />
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busy || !optionDraft(category.id).label.trim()}
                  onClick={() => void handleAddOption(category.id)}
                >+ {t(language, 'addOption')}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create category */}
      <div className="customization-create-cat">
        <h4>{t(language, 'createCategory')}</h4>
        <div className="customization-create-row">
          <input
            type="text"
            className="messenger-input"
            placeholder={t(language, 'categoryName')}
            maxLength={60}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateCategory(); }}
          />
          <select
            className="messenger-input"
            value={newSelectionType}
            onChange={(e) => setNewSelectionType(e.target.value as 'multi' | 'single')}
          >
            <option value="multi">{t(language, 'selectMany')}</option>
            <option value="single">{t(language, 'selectOne')}</option>
          </select>
        </div>
        <div className="customization-cat-toggles">
          <label className="customization-checkbox">
            <input type="checkbox" checked={newHideChannels} onChange={(e) => setNewHideChannels(e.target.checked)} />
            <span>{t(language, 'hideChannelsByRole')}</span>
          </label>
          <label className="customization-checkbox">
            <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
            <span>{t(language, 'requiredOnJoin')}</span>
          </label>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={busy || !newCategoryName.trim()}
          onClick={() => void handleCreateCategory()}
        >+ {t(language, 'createCategory')}</button>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}
    </div>
  );
}

// Lets the admin attach text channels to an option's auto-created hidden folder.
// The selected channels are gated by the option's role so only holders see them.
function ChannelGate({
  token,
  language,
  groupId,
  option,
  channels
}: {
  token: string;
  language: Language;
  groupId: string;
  option: CustomCategory['options'][number];
  channels: GroupChannel[];
}) {
  const [open, setOpen] = useState(false);
  const inFolder = channels.filter((c) => c.folderId === option.folderId);

  async function moveChannelIntoFolder(channelId: string) {
    await api.updateGroupChannel(token, groupId, channelId, { folderId: option.folderId });
    // Gate visibility by the option's backing role so only holders can see it.
    if (option.roleId) await api.setChannelRoles(token, groupId, channelId, [option.roleId]);
    setOpen(false);
  }

  return (
    <span className="customization-gate">
      <button type="button" className="customization-gate-btn" onClick={() => setOpen((v) => !v)}>
        🔒 {inFolder.length > 0 ? `${inFolder.length}` : t(language, 'addHiddenChannel')}
      </button>
      {open ? (
        <div className="customization-gate-menu">
          {channels.filter((c) => c.folderId !== option.folderId && c.type !== 'voice').map((channel) => (
            <button key={channel.id} type="button" onClick={() => void moveChannelIntoFolder(channel.id)}>
              # {channel.name}
            </button>
          ))}
          {channels.filter((c) => c.folderId !== option.folderId && c.type !== 'voice').length === 0 ? (
            <span className="muted-line">{t(language, 'noChannelsToAdd')}</span>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
