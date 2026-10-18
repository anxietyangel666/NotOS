import { useState, useEffect, useRef } from 'react';
import type { Language } from '../api/types';
import { api } from '../api/client';

type ProfileVoiceBioProps = {
  userId: string;
  isSelf: boolean;
  language: Language;
  initialBioUrl?: string | null;
  token?: string;
  onBioUpdated?: (url: string | null) => void;
};

const STORAGE_PREFIX = 'notoc.voicebio.';

export function getVoiceBio(userId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

export function saveVoiceBio(userId: string, dataUrl: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, dataUrl);
  } catch {
    /* ignore */
  }
}

export function deleteVoiceBio(userId: string) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}

export function ProfileVoiceBio({
  userId,
  isSelf,
  language,
  initialBioUrl,
  token,
  onBioUpdated
}: ProfileVoiceBioProps) {
  const [voiceBioUrl, setVoiceBioUrl] = useState<string | null>(
    () => initialBioUrl || getVoiceBio(userId)
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const effective = initialBioUrl !== undefined ? initialBioUrl : getVoiceBio(userId);
    setVoiceBioUrl(effective);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [userId, initialBioUrl]);

  // Audio lifecycle
  useEffect(() => {
    if (!voiceBioUrl) return;
    const a = new Audio(voiceBioUrl);
    audioRef.current = a;

    a.onloadedmetadata = () => {
      setDuration(Math.round(a.duration) || 5);
    };
    a.onended = () => {
      setIsPlaying(false);
    };

    return () => {
      a.pause();
      audioRef.current = null;
    };
  }, [voiceBioUrl]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
    } else {
      a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          setRecordedBlobUrl(base64);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordSeconds(0);

      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 9) {
            stopRecording();
            return 10;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      alert(language === 'ru' ? 'Не удалось получить доступ к микрофону' : 'Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      alert(language === 'ru' ? 'Пожалуйста, выберите аудиофайл' : 'Please select an audio file');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      alert(language === 'ru' ? 'Файл слишком большой (максимум 15 МБ)' : 'Audio file is too large (max 15 MB)');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setRecordedBlobUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveRecorded = async () => {
    if (!recordedBlobUrl) return;
    setIsSaving(true);
    let finalUrl = recordedBlobUrl;

    if (token) {
      try {
        const uploadRes = await api.uploadMessengerMedia(token, {
          dataUrl: recordedBlobUrl,
          name: 'voice_bio.webm'
        });
        if (uploadRes?.media?.dataUrl) {
          finalUrl = uploadRes.media.dataUrl;
        }
        await api.updateMe(token, { voiceBio: finalUrl });
      } catch (err) {
        console.warn('Voice bio server upload error, saving locally:', err);
      }
    }

    saveVoiceBio(userId, finalUrl);
    setVoiceBioUrl(finalUrl);
    setRecordedBlobUrl(null);
    setIsSaving(false);
    onBioUpdated?.(finalUrl);
  };

  const handleDelete = async () => {
    deleteVoiceBio(userId);
    setVoiceBioUrl(null);
    setRecordedBlobUrl(null);
    setIsPlaying(false);
    if (token) {
      try {
        await api.updateMe(token, { voiceBio: null });
      } catch {
        /* ignore */
      }
    }
    onBioUpdated?.(null);
  };

  if (!voiceBioUrl && !isSelf) {
    return null;
  }

  return (
    <div className="profile-voice-bio-container">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      {/* Existing voice bio playback card */}
      {voiceBioUrl && !isRecording && !recordedBlobUrl ? (
        <div className={`profile-voice-bio-card ${isPlaying ? 'playing' : ''}`}>
          <button
            type="button"
            className="voice-bio-play-btn"
            onClick={togglePlay}
            title={isPlaying ? (language === 'ru' ? 'Пауза' : 'Pause') : (language === 'ru' ? 'Слушать аудио-статус' : 'Play voice bio')}
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <div className="voice-bio-waves">
            <span className="wave-bar" />
            <span className="wave-bar" />
            <span className="wave-bar" />
            <span className="wave-bar" />
            <span className="wave-bar" />
          </div>

          <div className="voice-bio-info">
            <span className="voice-bio-label">
              {language === 'ru' ? 'Аудио-статус' : 'Voice Bio'}
            </span>
            <span className="voice-bio-time">0:0{duration || 5}</span>
          </div>

          {isSelf ? (
            <div className="voice-bio-self-actions">
              <button
                type="button"
                className="voice-bio-action-icon edit-icon"
                title={language === 'ru' ? 'Сменить аудио-статус' : 'Change voice bio'}
                onClick={startRecording}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
              <button
                type="button"
                className="voice-bio-action-icon del-icon"
                title={language === 'ru' ? 'Удалить' : 'Delete'}
                onClick={handleDelete}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Recording in progress */}
      {isRecording ? (
        <div className="profile-voice-bio-recording-bar">
          <span className="voice-bio-rec-dot" />
          <span className="voice-bio-rec-text">
            {language === 'ru' ? `Запись: ${recordSeconds}/10 сек.` : `Recording: ${recordSeconds}/10s`}
          </span>
          <button type="button" className="voice-bio-stop-btn" onClick={stopRecording}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            <span>{language === 'ru' ? 'Готово' : 'Done'}</span>
          </button>
        </div>
      ) : null}

      {/* Recorded preview before save */}
      {recordedBlobUrl ? (
        <div className="profile-voice-bio-preview-bar">
          <audio src={recordedBlobUrl} controls className="voice-bio-preview-player" />
          <div className="voice-bio-preview-actions">
            <button
              type="button"
              className="secondary-action compact"
              onClick={() => setRecordedBlobUrl(null)}
              disabled={isSaving}
            >
              {language === 'ru' ? 'Отмена' : 'Cancel'}
            </button>
            <button
              type="button"
              className="primary-action compact"
              onClick={handleSaveRecorded}
              disabled={isSaving}
            >
              {isSaving ? '...' : (language === 'ru' ? 'Сохранить' : 'Save')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Button to record or upload if self and none exists */}
      {!voiceBioUrl && isSelf && !isRecording && !recordedBlobUrl ? (
        <div className="profile-voice-bio-create-actions">
          <button
            type="button"
            className="profile-voice-bio-add-btn"
            onClick={startRecording}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span>{language === 'ru' ? 'Записать аудио-статус (до 10 сек.)' : 'Record Voice Bio (up to 10s)'}</span>
          </button>
          <button
            type="button"
            className="profile-voice-bio-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            title={language === 'ru' ? 'Загрузить аудиофайл' : 'Upload audio file'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
