import { useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { applyCallAudioConstraints, audioConstraintsFromCallSettings, describeKey, loadCallSettings, saveCallSettings, type CallSettings } from '../utils/call-settings';
import { createRnnoiseNode, destroyRnnoiseNode, setRnnoiseEnabled } from '../utils/rnnoise';
import { SaveBar } from './SaveBar';

type VoiceSettingsProps = {
  language: Language;
  onChange?: (settings: CallSettings) => void;
  /** Notifies the parent whenever the unsaved-changes state flips. */
  onDirtyChange?: (dirty: boolean) => void;
};

type DeviceOption = { deviceId: string; label: string };
type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const voiceCopy = {
  en: {
    devices: 'Devices',
    devicesHint: 'Select the microphone and speakers used for calls.',
    levels: 'Levels & test',
    levelsHint: 'Test your microphone and hear the processed signal.',
    input: 'Input mode',
    inputHint: 'Choose when your voice is sent.',
    processing: 'Microphone processing',
    processingHint: 'RNNoise + WebRTC filters are applied to calls and voice channels.',
    monitoring: 'You will hear yourself while the test is running.',
    noiseHint: 'Reduces steady background, keyboard, and fan noise through RNNoise.',
    echoHint: 'Reduces speaker echo and repeated voice capture.',
    gainHint: 'Automatically evens out microphone loudness.'
  },
  ru: {
    devices: 'Устройства',
    devicesHint: 'Выберите микрофон и динамики для звонков.',
    levels: 'Громкость и тест',
    levelsHint: 'Проверьте микрофон и услышите обработанный звук.',
    input: 'Режим ввода',
    inputHint: 'Выберите, когда голос будет отправляться.',
    processing: 'Обработка микрофона',
    processingHint: 'RNNoise + WebRTC-фильтры применяются к звонкам и голосовым каналам.',
    monitoring: 'Во время теста вы будете слышать себя.',
    noiseHint: 'Убирает постоянный фон, шум клавиатуры и вентилятора через RNNoise.',
    echoHint: 'Подавляет эхо от динамиков и повторный захват голоса.',
    gainHint: 'Автоматически выравнивает громкость микрофона.'
  },
  uk: {
    devices: 'Пристрої',
    devicesHint: 'Виберіть мікрофон і динаміки для дзвінків.',
    levels: 'Гучність і тест',
    levelsHint: 'Перевірте мікрофон і почуйте оброблений звук.',
    input: 'Режим вводу',
    inputHint: 'Виберіть, коли голос буде надсилатися.',
    processing: 'Обробка мікрофона',
    processingHint: 'RNNoise + WebRTC-фільтри застосовуються до дзвінків і голосових каналів.',
    monitoring: 'Під час тесту ви будете чути себе.',
    noiseHint: 'Прибирає постійний фон, шум клавіатури й вентилятора через RNNoise.',
    echoHint: 'Приглушує відлуння від динаміків і повторне захоплення голосу.',
    gainHint: 'Автоматично вирівнює гучність мікрофона.'
  },
  zh: {
    devices: '设备',
    devicesHint: '选择通话使用的麦克风和扬声器。',
    levels: '音量与测试',
    levelsHint: '测试麦克风并听处理后的声音。',
    input: '输入模式',
    inputHint: '选择何时发送你的声音。',
    processing: '麦克风处理',
    processingHint: '通话和语音频道会应用 RNNoise + WebRTC 滤镜。',
    monitoring: '测试期间你会听到自己的声音。',
    noiseHint: '通过 RNNoise 降低持续背景音、键盘声和风扇声。',
    echoHint: '减少扬声器回声和声音被再次拾取。',
    gainHint: '自动平衡麦克风音量。'
  },
  'zh-TW': {
    devices: '裝置',
    devicesHint: '選擇通話使用的麥克風和喇叭。',
    levels: '音量與測試',
    levelsHint: '測試麥克風並聽處理後的聲音。',
    input: '輸入模式',
    inputHint: '選擇何時傳送你的聲音。',
    processing: '麥克風處理',
    processingHint: '通話和語音頻道會套用 RNNoise + WebRTC 濾鏡。',
    monitoring: '測試期間你會聽到自己的聲音。',
    noiseHint: '透過 RNNoise 降低持續背景音、鍵盤聲和風扇聲。',
    echoHint: '減少喇叭回音和聲音被再次擷取。',
    gainHint: '自動平衡麥克風音量。'
  }
} satisfies Record<Language, Record<string, string>>;

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
  const testRnnoiseRef = useRef<AudioWorkletNode | null>(null);
  const testMonitorRef = useRef<SinkAudioElement | null>(null);
  const testMonitorGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const copy = voiceCopy[language];

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
    const previousSettings = savedSettings;
    saveCallSettings(settings);
    setSavedSettings(settings);
    onChange?.(settings);
    applySettingsToActiveTest(settings, previousSettings);
    // Notify any live call/voice room so settings apply immediately.
    window.dispatchEvent(new CustomEvent('notoc:callSettingsChanged'));
  }

  function resetVoiceSettings() {
    setSettings(savedSettings);
  }

  function applySettingsToActiveTest(next: CallSettings, previous: CallSettings) {
    if (!testing) return;
    if (next.inputDeviceId !== previous.inputDeviceId) {
      stopTest();
      window.setTimeout(() => {
        void startTest();
      }, 0);
      return;
    }
    setRnnoiseEnabled(testRnnoiseRef.current, next.noiseSuppression);
    void applyCallAudioConstraints(testStreamRef.current?.getAudioTracks()[0] ?? null, next);
    const volume = Math.min(1, Math.max(0, next.outputVolume / 100));
    if (testMonitorRef.current) {
      testMonitorRef.current.volume = volume;
      if (next.outputDeviceId !== 'default' && testMonitorRef.current.setSinkId) {
        void testMonitorRef.current.setSinkId(next.outputDeviceId).catch(() => undefined);
      }
    }
    if (testMonitorGainRef.current) {
      testMonitorGainRef.current.gain.value = volume;
    }
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
      event.stopPropagation();
      if (event.code !== 'Escape') update({ pushToTalkKey: event.code });
      setCapturingKey(false);
    };
    const onMouse = (event: MouseEvent) => {
      if (event.button === 1 || event.button === 3 || event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        const code = event.button === 1 ? 'Mouse3' : event.button === 3 ? 'Mouse4' : 'Mouse5';
        update({ pushToTalkKey: code });
        setCapturingKey(false);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('mousedown', onMouse, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('mousedown', onMouse, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturingKey]);

  useEffect(() => {
    const monitor = testMonitorRef.current;
    if (!monitor) return;
    const volume = Math.min(1, Math.max(0, settings.outputVolume / 100));
    monitor.volume = volume;
    if (testMonitorGainRef.current) {
      testMonitorGainRef.current.gain.value = volume;
    }
    if (settings.outputDeviceId !== 'default' && monitor.setSinkId) {
      void monitor.setSinkId(settings.outputDeviceId).catch(() => undefined);
    }
  }, [settings.outputDeviceId, settings.outputVolume]);

  async function startTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraintsFromCallSettings(settings)
      });
      testStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 48000 });
      testCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const monitorDest = ctx.createMediaStreamDestination();
      const rnnoiseNode = await createRnnoiseNode(ctx, settings.noiseSuppression);
      testRnnoiseRef.current = rnnoiseNode;
      if (rnnoiseNode) {
        source.connect(rnnoiseNode);
        rnnoiseNode.connect(analyser);
        rnnoiseNode.connect(monitorDest);
      } else {
        source.connect(analyser);
        source.connect(monitorDest);
      }
      const monitor = new Audio() as SinkAudioElement;
      monitor.srcObject = monitorDest.stream;
      monitor.volume = Math.min(1, Math.max(0, settings.outputVolume / 100));
      if (settings.outputDeviceId !== 'default' && monitor.setSinkId) {
        await monitor.setSinkId(settings.outputDeviceId).catch(() => undefined);
      }
      testMonitorRef.current = monitor;
      void monitor.play().catch(() => {
        if (testCtxRef.current !== ctx) return;
        const fallbackGain = ctx.createGain();
        fallbackGain.gain.value = Math.min(1, Math.max(0, settings.outputVolume / 100));
        testMonitorGainRef.current = fallbackGain;
        try {
          if (rnnoiseNode) {
            rnnoiseNode.connect(fallbackGain);
          } else {
            source.connect(fallbackGain);
          }
          fallbackGain.connect(ctx.destination);
        } catch {
          testMonitorGainRef.current = null;
        }
      });
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
    if (testMonitorRef.current) {
      testMonitorRef.current.pause();
      testMonitorRef.current.srcObject = null;
      testMonitorRef.current = null;
    }
    testMonitorGainRef.current = null;
    destroyRnnoiseNode(testRnnoiseRef.current);
    testRnnoiseRef.current = null;
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

      <section className="voice-settings-card">
        <div className="voice-settings-card-head">
          <strong>{copy.devices}</strong>
          <span>{copy.devicesHint}</span>
        </div>
        <div className="voice-settings-grid">
          <label className="voice-control-field">
            <span className="field-label">{t(language, 'inputDevice')}</span>
            <select className="text-field" value={settings.inputDeviceId} onChange={(e) => update({ inputDeviceId: e.target.value })}>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="voice-control-field">
            <span className="field-label">{t(language, 'outputDevice')}</span>
            <select className="text-field" value={settings.outputDeviceId} onChange={(e) => update({ outputDeviceId: e.target.value })}>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="voice-settings-card">
        <div className="voice-settings-card-head">
          <strong>{copy.levels}</strong>
          <span>{copy.levelsHint}</span>
        </div>
        <div className="voice-range-row">
          <label className="field-label">{t(language, 'micVolume')} - {settings.micVolume}%</label>
          <input type="range" min={0} max={200} value={settings.micVolume} onChange={(e) => update({ micVolume: Number(e.target.value) })} />
        </div>
        <div className="voice-range-row">
          <label className="field-label">{t(language, 'outputVolume')} - {settings.outputVolume}%</label>
          <input type="range" min={0} max={100} value={settings.outputVolume} onChange={(e) => update({ outputVolume: Number(e.target.value) })} />
        </div>
        <div className="voice-test">
          <button className="secondary-action" type="button" onClick={() => (testing ? stopTest() : void startTest())}>
            {testing ? t(language, 'stopMicTest') : t(language, 'testMic')}
          </button>
          <div className="voice-level-bar"><span style={{ width: `${level}%` }} /></div>
        </div>
        {testing ? <div className="voice-monitor-note">{copy.monitoring}</div> : null}
      </section>

      <section className="voice-settings-card">
        <div className="voice-settings-card-head">
          <strong>{copy.input}</strong>
          <span>{copy.inputHint}</span>
        </div>
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
      </section>

      <div className="voice-settings-card voice-processing-card">
        <div className="voice-settings-card-head">
          <strong>{copy.processing}</strong>
          <span>{copy.processingHint}</span>
        </div>
        <label className="voice-checkbox">
          <input type="checkbox" checked={settings.noiseSuppression} onChange={(e) => { update({ noiseSuppression: e.target.checked }); setRnnoiseEnabled(testRnnoiseRef.current, e.target.checked); }} />
          <span>
            <strong>{t(language, 'noiseSuppression')}</strong>
            <small>{copy.noiseHint}</small>
          </span>
        </label>
        <label className="voice-checkbox">
          <input type="checkbox" checked={settings.echoCancellation} onChange={(e) => update({ echoCancellation: e.target.checked })} />
          <span>
            <strong>{t(language, 'echoCancellation')}</strong>
            <small>{copy.echoHint}</small>
          </span>
        </label>
        <label className="voice-checkbox">
          <input type="checkbox" checked={settings.autoGainControl} onChange={(e) => update({ autoGainControl: e.target.checked })} />
          <span>
            <strong>{t(language, 'autoGainControl')}</strong>
            <small>{copy.gainHint}</small>
          </span>
        </label>
      </div>

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
