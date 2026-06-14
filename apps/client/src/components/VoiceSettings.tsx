import { useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { describeKey, loadCallSettings, saveCallSettings, type CallSettings } from '../utils/call-settings';
import { SaveBar } from './SaveBar';

type VoiceSettingsProps = {
  language: Language;
  onChange?: (settings: CallSettings) => void;
  /** Notifies the parent whenever the unsaved-changes state flips. */
  onDirtyChange?: (dirty: boolean) => void;
};

type DeviceOption = { deviceId: string; label: string };

export function VoiceSettings({ language, onChange, onDirtyChange }: VoiceSettingsProps) {
  const [settings, setSettings] = useState<CallSettings>(loadCallSettings);
  // Last-persisted baseline used to detect unsaved changes.
  const [savedSettings, setSavedSettings] = useState<CallSettings>(loadCallSettings);
  const [inputs, setInputs] = useState<DeviceOption[]>([]);
  const [outputs, setOutputs] = useState<DeviceOption[]>([]);
  const [capturingKey, setCapturingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [permissionError, setPermissionError] = useState(false);
  const [barShake, setBarShake] = useState(0);

  const testStreamRef = useRef<MediaStream | null>(null);
  const testCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  // Edit the local draft only. Changes are persisted via the save bar so they
  // do not take effect until the user explicitly saves.
  function update(patch: Partial<CallSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings]
  );

  function saveVoiceSettings() {
    saveCallSettings(settings);
    setSavedSettings(settings);
    onChange?.(settings);
    // Notify any live call/voice room so settings apply immediately.
    window.dispatchEvent(new CustomEvent('notoc:callSettingsChanged'));
  }

  function resetVoiceSettings() {
    setSettings(savedSettings);
  }

  // Keep the parent informed of unsaved changes so it can block window close.
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  // The parent dispatches this when a close is blocked by unsaved changes.
  useEffect(() => {
    const onShake = () => setBarShake((n) => n + 1);
    window.addEventListener('notoc:voiceSettingsShake', onShake);
    return () => window.removeEventListener('notoc:voiceSettingsShake', onShake);
  }, []);

  async function loadDevices() {
    try {
      // Request permission so device labels become available.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      setPermissionError(false);
    } catch {
      setPermissionError(true);
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs([
        { deviceId: 'default', label: t(language, 'systemDefault') },
        ...devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label || t(language, 'microphone') }))
      ]);
      setOutputs([
        { deviceId: 'default', label: t(language, 'systemDefault') },
        ...devices.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || t(language, 'speakers') }))
      ]);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadDevices();
    const handler = () => void loadDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', handler);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', handler);
      stopTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!capturingKey) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.code !== 'Escape') update({ pushToTalkKey: event.code });
      setCapturingKey(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturingKey]);

  async function startTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.inputDeviceId !== 'default' ? { exact: settings.inputDeviceId } : undefined,
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl
        }
      });
      testStreamRef.current = stream;
      const ctx = new AudioContext();
      testCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(100, Math.round(rms * 200 * (settings.micVolume / 100))));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setTesting(true);
    } catch {
      setPermissionError(true);
    }
  }

  function stopTest() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    testStreamRef.current?.getTracks().forEach((track) => track.stop());
    testStreamRef.current = null;
    if (testCtxRef.current) {
      void testCtxRef.current.close().catch(() => undefined);
      testCtxRef.current = null;
    }
    setLevel(0);
    setTesting(false);
  }

  return (
    <div className="settings-section voice-settings">
      <h3>{t(language, 'voiceVideoSettings')}</h3>

      {permissionError ? <div className="inline-error">{t(language, 'micPermissionNeeded')}</div> : null}

      <label className="field-label">{t(language, 'inputDevice')}</label>
      <select className="text-field" value={settings.inputDeviceId} onChange={(e) => update({ inputDeviceId: e.target.value })}>
        {inputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>

      <label className="field-label">{t(language, 'outputDevice')}</label>
      <select className="text-field" value={settings.outputDeviceId} onChange={(e) => update({ outputDeviceId: e.target.value })}>
        {outputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>

      <label className="field-label">{t(language, 'micVolume')} — {settings.micVolume}%</label>
      <input type="range" min={0} max={200} value={settings.micVolume} onChange={(e) => update({ micVolume: Number(e.target.value) })} />

      <label className="field-label">{t(language, 'outputVolume')} — {settings.outputVolume}%</label>
      <input type="range" min={0} max={100} value={settings.outputVolume} onChange={(e) => update({ outputVolume: Number(e.target.value) })} />

      <div className="voice-test">
        <button className="secondary-action" type="button" onClick={() => (testing ? stopTest() : void startTest())}>
          {testing ? t(language, 'stopMicTest') : t(language, 'testMic')}
        </button>
        <div className="voice-level-bar"><span style={{ width: `${level}%` }} /></div>
      </div>

      <hr className="settings-divider" />

      <label className="field-label">{t(language, 'inputMode')}</label>
      <div className="voice-mode-toggle">
        <button className={!settings.pushToTalk ? 'voice-mode active' : 'voice-mode'} type="button" onClick={() => update({ pushToTalk: false })}>
          {t(language, 'voiceActivity')}
        </button>
        <button className={settings.pushToTalk ? 'voice-mode active' : 'voice-mode'} type="button" onClick={() => update({ pushToTalk: true })}>
          {t(language, 'pushToTalk')}
        </button>
      </div>

      {settings.pushToTalk ? (
        <div className="voice-ptt-key">
          <span>{t(language, 'pushToTalkKey')}</span>
          <button className="secondary-action" type="button" onClick={() => setCapturingKey(true)}>
            {capturingKey ? t(language, 'pressAnyKey') : describeKey(settings.pushToTalkKey, t(language, 'notSet'))}
          </button>
        </div>
      ) : null}

      <hr className="settings-divider" />

      <label className="voice-checkbox">
        <input type="checkbox" checked={settings.echoCancellation} onChange={(e) => update({ echoCancellation: e.target.checked })} />
        <span>{t(language, 'echoCancellation')}</span>
      </label>
      <label className="voice-checkbox">
        <input type="checkbox" checked={settings.noiseSuppression} onChange={(e) => update({ noiseSuppression: e.target.checked })} />
        <span>{t(language, 'noiseSuppression')}</span>
      </label>
      <label className="voice-checkbox">
        <input type="checkbox" checked={settings.autoGainControl} onChange={(e) => update({ autoGainControl: e.target.checked })} />
        <span>{t(language, 'autoGainControl')}</span>
      </label>

      <SaveBar
        language={language}
        dirty={dirty}
        shakeKey={barShake}
        onReset={resetVoiceSettings}
        onSave={saveVoiceSettings}
      />
    </div>
  );
}
