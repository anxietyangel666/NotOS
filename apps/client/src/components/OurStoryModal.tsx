import { useMemo } from 'react';
import type { Language, MessengerMessage, PublicUser } from '../api/types';
import { Twemoji } from './Twemoji';
import { LevelRing } from './LevelRing';

type OurStoryModalProps = {
  currentUser: PublicUser;
  friendUser: PublicUser;
  messages: MessengerMessage[];
  language: Language;
  friendshipDate?: string | null;
  onClose: () => void;
};

export function OurStoryModal({
  currentUser,
  friendUser,
  messages,
  language,
  friendshipDate,
  onClose
}: OurStoryModalProps) {
  const stats = useMemo(() => {
    let myCount = 0;
    let friendCount = 0;
    let mediaCount = 0;
    let voiceCount = 0;
    let nightCount = 0;

    let earliestDate: Date | null = friendshipDate ? new Date(friendshipDate) : null;

    messages.forEach((m) => {
      const d = new Date(m.createdAt);
      if (!earliestDate || d < earliestDate) {
        earliestDate = d;
      }
      if (m.senderId === currentUser.id) myCount++;
      else if (m.senderId === friendUser.id) friendCount++;

      if (m.imageData || (m.mediaItems && m.mediaItems.length > 0)) {
        mediaCount += (m.mediaItems?.length || 1);
      }
      if (m.body && (m.body.includes('[voice:') || m.imageName?.endsWith('.webm') || m.imageName?.endsWith('.ogg'))) {
        voiceCount++;
      }
      const hour = d.getHours();
      if (hour >= 0 && hour < 6) {
        nightCount++;
      }
    });

    const firstTime = earliestDate ? earliestDate.getTime() : Date.now();
    const daysTogether = Math.max(1, Math.floor((Date.now() - firstTime) / (86400 * 1000)));

    return {
      totalMessages: myCount + friendCount,
      myCount,
      friendCount,
      mediaCount,
      voiceCount,
      nightCount,
      daysTogether,
      firstDate: earliestDate ? earliestDate.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Недавно'
    };
  }, [messages, currentUser.id, friendUser.id, friendshipDate, language]);

  const milestones = [
    {
      icon: '💫',
      title: language === 'ru' ? 'Первая искра' : 'First Spark',
      desc: language === 'ru' ? `Начало общения: ${stats.firstDate}` : `Started: ${stats.firstDate}`,
      achieved: true
    },
    {
      icon: '💬',
      title: language === 'ru' ? 'Теплый диалог' : 'Warm Conversation',
      desc: language === 'ru' ? 'Более 50 сообщений в чате' : 'Over 50 messages sent',
      achieved: stats.totalMessages >= 50,
      progress: Math.min(100, Math.round((stats.totalMessages / 50) * 100))
    },
    {
      icon: '🏆',
      title: language === 'ru' ? 'Неразлучные' : 'Inseparable Duo',
      desc: language === 'ru' ? 'Более 200 сообщений в чате' : 'Over 200 messages sent',
      achieved: stats.totalMessages >= 200,
      progress: Math.min(100, Math.round((stats.totalMessages / 200) * 100))
    },
    {
      icon: '📸',
      title: language === 'ru' ? 'Архив воспоминаний' : 'Memory Vault',
      desc: language === 'ru' ? 'Более 10 общих фото и медиа' : 'Over 10 shared photos/media',
      achieved: stats.mediaCount >= 10,
      progress: Math.min(100, Math.round((stats.mediaCount / 10) * 100))
    },
    {
      icon: '🌌',
      title: language === 'ru' ? 'Полуночники' : 'Night Owls',
      desc: language === 'ru' ? 'Ночные переписки после полуночи' : 'Late night chats past midnight',
      achieved: stats.nightCount >= 5,
      progress: Math.min(100, Math.round((stats.nightCount / 5) * 100))
    }
  ];

  return (
    <div className="messenger-inline-modal our-story-modal-layer" onClick={onClose}>
      <div className="our-story-modal" onClick={(e) => e.stopPropagation()}>
        <div className="our-story-header">
          <div className="our-story-avatars-row">
            <div className="our-story-avatar-wrap">
              <img src={currentUser.avatarData} alt="" className="our-story-avatar" />
              <LevelRing xp={currentUser.xp || 0} language={language} />
            </div>

            <div className="our-story-connection">
              <span className="our-story-heart">💖</span>
              <div className="our-story-beam" />
            </div>

            <div className="our-story-avatar-wrap">
              <img src={friendUser.avatarData} alt="" className="our-story-avatar" />
              <LevelRing xp={friendUser.xp || 0} language={language} />
            </div>
          </div>

          <h2 className="our-story-title">
            {language === 'ru' ? 'Наша история' : 'Our Friendship Story'}
          </h2>
          <p className="our-story-subtitle">
            {language === 'ru'
              ? `${currentUser.nickname} и ${friendUser.nickname} вместе уже ${stats.daysTogether} дн.`
              : `${currentUser.nickname} & ${friendUser.nickname} together for ${stats.daysTogether} days`}
          </p>

          <button type="button" className="our-story-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="our-story-stats-grid">
          <div className="our-story-stat-card">
            <span className="stat-card-icon">⏳</span>
            <span className="stat-card-val">{stats.daysTogether}</span>
            <span className="stat-card-label">{language === 'ru' ? 'Дней вместе' : 'Days together'}</span>
          </div>

          <div className="our-story-stat-card">
            <span className="stat-card-icon">💬</span>
            <span className="stat-card-val">{stats.totalMessages}</span>
            <span className="stat-card-label">{language === 'ru' ? 'Всего сообщений' : 'Total messages'}</span>
            <span className="stat-card-sublabel">{stats.myCount} / {stats.friendCount}</span>
          </div>

          <div className="our-story-stat-card">
            <span className="stat-card-icon">📷</span>
            <span className="stat-card-val">{stats.mediaCount}</span>
            <span className="stat-card-label">{language === 'ru' ? 'Медиафайлов' : 'Shared media'}</span>
          </div>

          <div className="our-story-stat-card">
            <span className="stat-card-icon">🌙</span>
            <span className="stat-card-val">{stats.nightCount}</span>
            <span className="stat-card-label">{language === 'ru' ? 'Ночных бесед' : 'Night chats'}</span>
          </div>
        </div>

        <div className="our-story-milestones-section">
          <h3 className="milestones-section-title">
            🌟 {language === 'ru' ? 'Достижения и вехи' : 'Milestones & Memories'}
          </h3>

          <div className="our-story-milestones-list">
            {milestones.map((m, idx) => (
              <div key={idx} className={`our-story-milestone-item ${m.achieved ? 'achieved' : 'locked'}`}>
                <div className="milestone-badge">
                  <span>{m.icon}</span>
                </div>
                <div className="milestone-content">
                  <div className="milestone-title-row">
                    <span className="milestone-title">{m.title}</span>
                    <span className="milestone-status">
                      {m.achieved ? (language === 'ru' ? '✓ Открыто' : '✓ Unlocked') : `${m.progress}%`}
                    </span>
                  </div>
                  <span className="milestone-desc">{m.desc}</span>
                  {!m.achieved && typeof m.progress === 'number' ? (
                    <div className="milestone-progress-bar">
                      <div className="milestone-progress-fill" style={{ width: `${m.progress}%` }} />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="our-story-footer">
          <button type="button" className="primary-action our-story-ok-btn" onClick={onClose}>
            {language === 'ru' ? 'Прекрасно!' : 'Awesome!'}
          </button>
        </div>
      </div>
    </div>
  );
}
