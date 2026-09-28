/**
 * NotOS Official Landing Page Scripts
 * Multi-language Engine, Live Health/Latency Monitor, Auto-updater Link Resolver, Modals, Desktop Clock
 */

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
  ? 'http://163.5.16.156:4000'
  : ''; // Same origin in production via Nginx proxy

// Translations Dictionary
const TRANSLATIONS = {
  ru: {
    nav_features: 'Возможности',
    nav_preview: 'Интерфейс',
    nav_status: 'Статус',
    nav_download: 'Скачать',
    nav_get_app: 'Скачать',
    status_online: 'Сервер онлайн',
    status_offline: 'Сервер недоступен',

    hero_pill: 'NotOS Desktop — Обновление 0.5.6 уже доступно',
    hero_title: 'Ваш виртуальный рабочий стол для <span class="gradient-text">общения и отдыха</span>',
    hero_subtitle: 'NotOS переносит виртуальный рабочий стол в мессенджер: кастомные обои, совместный просмотр фильмов, визиты к друзьям, видео-кружочки и AI-помощник в одном быстром приложении.',
    btn_download_windows: 'Скачать для Windows',
    btn_learn_more: 'Узнать подробнее',

    meta_desktop: 'Виртуальный Desktop OS',
    meta_watch: 'Watch Together & Кино',
    meta_privacy: 'Приватность без номеров',
    meta_updates: 'Автообновления в 1 клик',

    preview_tag: 'ИНТЕРФЕЙС NOTOS',
    preview_title: 'Настоящий рабочий стол 1-в-1',
    preview_subtitle: 'Никаких однообразных серых колонок. NotOS объединяет плавающие окна мессенджера, кинотеатр Watch Together, музыкальный плеер и нативную панель задач Taskbar.',

    features_tag: 'ВОЗМОЖНОСТИ NOTOS',
    features_title: 'Больше чем мессенджер — персональная экосистема',
    features_subtitle: 'Исследуйте возможности NotOS в интерактивном формате: от виртуального рабочего стола до визитов к друзьям и умного AI.',

    b1_title: 'Виртуальный Рабочий Стол (Desktop OS)',
    b1_desc: 'Свободно перемещайте окна, ставьте собственные динамические и видео-обои до 10 МБ, управляйте виджетами и панелью задач Taskbar. Интерфейс, который подстраивается под вас.',
    b2_title: 'Watch Together & Кинотеатр',
    b2_desc: 'Смотрите фильмы, YouTube, аниме и сериалы синхронно с друзьями. Покадровая синхронизация воспроизведения, перемотки и паузы для всех участников.',
    b3_title: 'Удаленный рабочий стол друзей',
    b3_desc: 'Заходите в гости на рабочий стол друга в один клик: слушайте его музыку, изучайте его оформление и оставляйте сообщения на его стене профиля.',
    b4_title: 'Видео-кружочки и HD-звук',
    b4_desc: 'Записывайте видеосообщения в Telegram-стиле прямо на рабочем столе и отправляйте голосовые с живой анимацией звуковой волны и кристальным 48 kHz звуком.',
    b5_title: 'Стена профиля и музыкальный плеер',
    b5_desc: 'Персональная доска для друзей: оставляйте треки, стикеры, взрывы эмодзи (Emoji Bursts) и закрепляйте памятные медиа-карточки.',
    b6_title: 'Кастомные NamePlates & Неон',
    b6_desc: 'Выделяйтесь уникальными неоновыми подложками для никнеймов, кастомными градиентами, бейджами и темами оформления (Dark, Blue, Mint).',
    b7_title: 'Встроенный AI-Ассистент',
    b7_desc: 'Умная нейросеть прямо в отдельном окне: поможет с кодом, переводом, идеями и решением любых вопросов прямо во время общения.',
    b8_title: 'Приватность без номеров телефонов',
    b8_desc: 'Никаких телефонных номеров, спама и утечек. Вход по защищенному Auth-файлу сессии и PIN-коду. Ваши ключи хранятся только локально.',

    status_monitoring: 'МОНИТОРИНГ СЕРВЕРОВ',
    status_heading: 'Состояние сервисов NotOS',
    status_all_operational: 'Все системы работают',
    status_degraded: 'Частичные неполадки',
    service_voice: 'Голосовой сигналлинг (WebSockets)',
    service_api: 'API Сервер и авторизация',
    service_updates: 'Сервер обновлений (Auto-Update)',
    service_webrtc: 'WebRTC & P2P Стриминг',
    status_latency: 'Текущая задержка:',
    status_refresh: 'Проверить снова',

    cta_title: 'Готовы общаться на новом уровне?',
    cta_desc: 'Скачайте клиент NotOS для Windows бесплатно прямо сейчас. Установка занимает меньше минуты, а все обновления приходят автоматически.',
    btn_download_full: 'Скачать NotOS для Windows',
    cta_whats_new: 'Что нового в v0.5.6:',
    cta_notes: 'Мгновенное удаление сообщений в ЛС и группах (0ms отклик), фикс списка диалогов, мгновенная отправка и удаление на стене рабочего стола.',

    footer_tagline: 'Мессенджер нового поколения для голосового общения, звонков и совместного просмотра.',
    footer_rights: 'Все права защищены.',
    footer_product: 'Продукт',
    footer_legal: 'Правовая информация',
    modal_privacy_title: 'Политика конфиденциальности',
    modal_terms_title: 'Условия использования',

    privacy_body: `
      <h4>1. Общие положения</h4>
      <p>Настоящая Политика конфиденциальности описывает, как сервис NotOS (далее — «Сервис») обрабатывает и защищает данные пользователей. Мы уважительно относимся к вашей приватности и сводим сбор информации к строго необходимому минимуму для обеспечения связи.</p>
      <h4>2. Сбор и использование информации</h4>
      <p>NotOS собирает только базовые данные, необходимые для вашей авторизации и функционирования комнат: ваш никнейм, уникальный идентификатор сессии и выбранные вами пользовательские настройки. Все персональные файлы сессий и ключи авторизации генерируются и хранятся локально на вашем компьютере.</p>
      <h4>3. Голосовые данные и медиапотоки</h4>
      <p>Голосовые и видеопотоки во время звонков и конференций передаются по зашифрованным WebRTC-каналам напрямую между участниками либо через защищенные медиа-шлюзы. Мы не ведем скрытую запись ваших разговоров и не сохраняем содержимое трансляций экранов.</p>
      <h4>4. Передача третьим лицам</h4>
      <p>Мы принципиально не продаем, не передаем и не монетизируем пользовательские данные рекламным сетям или аналитическим трекерам.</p>
      <h4>5. Обновления политики</h4>
      <p>Политика конфиденциальности может обновляться по мере добавления новых функций. Актуальная версия всегда доступна на официальном сайте notos.tech.</p>
    `,

    terms_body: `
      <h4>1. Принятие условий</h4>
      <p>Используя клиент или сервисы NotOS, вы соглашаетесь соблюдать настоящие Условия использования. Если вы не согласны с какими-либо положениями, пожалуйста, воздержитесь от использования Сервиса.</p>
      <h4>2. Правила поведения</h4>
      <p>Пользователям запрещается использовать Сервис для распространения вредоносного программного обеспечения, организации спам-рассылок, нарушения законов, оскорблений и действий, нарушающих работу инфраструктуры Сервиса.</p>
      <h4>3. Интеллектуальная собственность</h4>
      <p>Все права на графические материалы, код, бренд и логотип NotOS принадлежат разработчикам проекта. Вы получаете право использовать клиентское приложение исключительно в личных некоммерческих целях.</p>
      <h4>4. Отказ от гарантий</h4>
      <p>Сервис предоставляется по принципу «как есть» (as is). Мы постоянно работаем над улучшением стабильности и безопасности, однако не несем ответственности за временные перебои со связью у третьих провайдеров.</p>
    `
  },

  en: {
    nav_features: 'Features',
    nav_preview: 'Preview',
    nav_status: 'Status',
    nav_download: 'Download',
    nav_get_app: 'Get NotOS',
    status_online: 'Server Online',
    status_offline: 'Server Offline',

    hero_pill: 'NotOS Desktop — Update 0.5.6 is now available',
    hero_title: 'Your personal virtual desktop for <span class="gradient-text">chatting, calls,</span> and media',
    hero_subtitle: 'NotOS transforms your messenger into a full virtual desktop: custom wallpapers, synchronized watch parties, visiting friend desktops, video circles, and an integrated AI assistant.',
    btn_download_windows: 'Download for Windows',
    btn_learn_more: 'Explore Features',

    meta_desktop: 'Virtual Desktop OS',
    meta_watch: 'Watch Together Sync',
    meta_privacy: 'Privacy (No Phone Numbers)',
    meta_updates: '1-Click Silent Updates',

    preview_tag: 'NOTOS INTERFACE',
    preview_title: 'Authentic Desktop Experience',
    preview_subtitle: 'No more mundane single-column chat feeds. NotOS brings floating messenger windows, synchronized cinema, desktop widgets, and a native taskbar.',

    features_tag: 'NOTOS CAPABILITIES',
    features_title: 'More Than a Messenger — A Personal Ecosystem',
    features_subtitle: 'Explore NotOS capabilities: from virtual desktop customization to friend desktop visits and smart AI.',

    b1_title: 'Virtual Desktop OS',
    b1_desc: 'Freely drag and arrange windows, set custom live video wallpapers up to 10 MB, and manage desktop widgets with a full taskbar. An interface that molds to you.',
    b2_title: 'Watch Together & Cinema',
    b2_desc: 'Watch movies, YouTube, anime, and series synchronously with friends. Frame-perfect playback sync, seek, and pause for everyone in the room.',
    b3_title: 'Friend Remote Desktop',
    b3_desc: "Visit your friend's desktop in one click: listen to their music library, explore their personalized theme, and post on their wall.",
    b4_title: 'Video Circles & HD Audio',
    b4_desc: 'Record instant video message circles and send voice notes with real-time waveform visualization and crystal-clear 48 kHz WebRTC audio.',
    b5_title: 'Desktop Wall & Music Player',
    b5_desc: "Your personal interactive guest wall: share tracks, stickers, emoji bursts, and pin memories directly on your friend's desktop.",
    b6_title: 'Custom NamePlates & Styling',
    b6_desc: 'Stand out with exclusive glowing neon NamePlates for your nickname, custom gradients, status badges, and hand-crafted themes.',
    b7_title: 'Built-in AI Assistant',
    b7_desc: 'Intelligent AI assistant right inside its own desktop window: drafts code, translates conversations, and answers questions without leaving NotOS.',
    b8_title: 'Privacy: Auth File & PIN Lock',
    b8_desc: 'No phone numbers, spam, or leaky cloud passwords. Instant authentication via encrypted local Auth files and optional PIN lock.',

    status_monitoring: 'SERVER MONITORING',
    status_heading: 'NotOS Network Infrastructure',
    status_all_operational: 'All Systems Operational',
    status_degraded: 'Partial Degradation',
    service_voice: 'Voice Signaling (WebSockets)',
    service_api: 'API Server & Auth Gateways',
    service_updates: 'Auto-Update CDN Server',
    service_webrtc: 'WebRTC P2P Media Relays',
    status_latency: 'Current Latency:',
    status_refresh: 'Check Again',

    cta_title: 'Ready to elevate your communication?',
    cta_desc: 'Download the NotOS Windows desktop client for free today. Setup takes under a minute, with seamless automatic updates.',
    btn_download_full: 'Download NotOS for Windows',
    cta_whats_new: "What's new in v0.5.6:",
    cta_notes: 'Instant optimistic message deletion in DMs and groups (0ms response), conversation preview preservation, instant sending and deletion on the Desktop Wall.',

    footer_tagline: 'Next-generation messenger for voice communication, direct calls, and watching media together.',
    footer_rights: 'All rights reserved.',
    footer_product: 'Product',
    footer_legal: 'Legal',
    modal_privacy_title: 'Privacy Policy',
    modal_terms_title: 'Terms of Service',

    privacy_body: `
      <h4>1. Overview</h4>
      <p>This Privacy Policy explains how NotOS ("Service") collects, protects, and handles your information. We value your privacy and keep data collection strictly minimal.</p>
      <h4>2. Data Collection</h4>
      <p>NotOS only processes basic session information necessary for authentication and voice room operation: chosen nickname, session identifiers, and user preferences. Authentication credentials and files are stored locally on your machine.</p>
      <h4>3. Voice & Media Streams</h4>
      <p>Voice and screen share media are transmitted via encrypted WebRTC connections directly between peers or via secure media gateways. We never record your voice calls or store screen share frames.</p>
      <h4>4. Third-Party Sharing</h4>
      <p>We do not sell, rent, or monetize personal information with advertisers or tracking networks.</p>
    `,

    terms_body: `
      <h4>1. Acceptance</h4>
      <p>By using NotOS applications or infrastructure, you agree to these Terms of Service. If you disagree with any part, please cease using the application.</p>
      <h4>2. User Conduct</h4>
      <p>You agree not to use the Service for spamming, transmitting malicious payloads, violating applicable laws, or disrupting the network infrastructure.</p>
      <h4>3. Intellectual Property</h4>
      <p>All brand assets, source code, logos, and designs of NotOS belong to the NotOS development team. You are granted a personal, non-commercial license to use the client.</p>
    `
  },

  uk: {
    nav_features: 'Можливості',
    nav_preview: 'Інтерфейс',
    nav_status: 'Статус',
    nav_download: 'Завантажити',
    nav_get_app: 'Завантажити',
    status_online: 'Сервер онлайн',
    status_offline: 'Сервер недоступний',

    hero_pill: 'NotOS Desktop — Оновлення 0.5.6 вже доступне',
    hero_title: 'Ваш віртуальний робочий стіл для <span class="gradient-text">спілкування та відпочинку</span>',
    hero_subtitle: 'NotOS переносить віртуальний робочий стіл у месенджер: кастомні шпалери, спільний перегляд фільмів, візити до друзів, відео-кружечки та AI-помічник в одному швидкому додатку.',
    btn_download_windows: 'Завантажити для Windows',
    btn_learn_more: 'Дізнатися більше',

    meta_desktop: 'Віртуальний Desktop OS',
    meta_watch: 'Watch Together & Кіно',
    meta_privacy: 'Приватність без номерів',
    meta_updates: 'Автооновлення в 1 клік',

    preview_tag: 'ІНТЕРФЕЙС NOTOS',
    preview_title: 'Справжній робочий стіл 1-в-1',
    preview_subtitle: 'Жодних одноманітних сірих колонок. NotOS поєднує плаваючі вікна месенджера, кінотеатр Watch Together, музичний плеєр та нативну панель завдань Taskbar.',

    features_tag: 'МОЖЛИВОСТІ NOTOS',
    features_title: 'Більше ніж месенджер — персональна екосистема',
    features_subtitle: 'Досліджуйте можливості NotOS: від віртуального робочого столу до візитів до друзів та розумного AI.',

    b1_title: 'Віртуальний Робочий Стіл (Desktop OS)',
    b1_desc: 'Вільно переміщуйте вікна, встановлюйте власні динамічні та відео-шпалери до 10 МБ, керуйте віджетами та панеллю завдань Taskbar. Інтерфейс підлаштовується під вас.',
    b2_title: 'Watch Together & Кінотеатр',
    b2_desc: 'Дивіться фільми, YouTube, аніме та серіали синхронно з друзями. Покадрова синхронізація відтворення, перемотування та паузи.',
    b3_title: 'Віддалений робочий стіл друзів',
    b3_desc: 'Заходьте в гості на робочий стіл друга в один клік: слухайте його музику, дивіться оформлення та залишайте повідомлення на його стіні.',
    b4_title: 'Відео-кружечки та HD-звук',
    b4_desc: 'Записуйте відеоповідомлення в Telegram-стилі та надсилайте голосові з живою анімацією звукової хвилі та кришталевим 48 kHz звуком.',
    b5_title: 'Стіна профілю та музичний плеєр',
    b5_desc: "Персональна дошка для друзів: залишайте треки, стікери, вибухи емодзі (Emoji Bursts) та закріплюйте пам'ятні медіа-картки.",
    b6_title: 'Кастомні NamePlates & Неон',
    b6_desc: 'Виділяйтеся унікальними неоновими підкладками для нікнеймів, кастомними градієнтами, бейджами та темами оформлення.',
    b7_title: 'Вбудований AI-Асистент',
    b7_desc: 'Розумна нейромережа просто в окремому вікні: допоможе з кодом, перекладом, ідеями та відповідями на будь-які питання.',
    b8_title: 'Приватність без номерів телефонів',
    b8_desc: 'Жодних номерів телефонів, спаму та витоків. Вхід за захищеним Auth-файлом сесії та PIN-кодом. Ваші ключі зберігаються локально.',

    status_monitoring: 'МОНІТОРИНГ СЕРВЕРІВ',
    status_heading: 'Стан сервісів NotOS',
    status_all_operational: 'Всі системи працюють',
    status_degraded: 'Часткові неполадки',
    service_voice: 'Голосовий сигналінг (WebSockets)',
    service_api: 'API Сервер та авторизація',
    service_updates: 'Сервер оновлень (Auto-Update)',
    service_webrtc: 'WebRTC & P2P Стрімінг',
    status_latency: 'Поточна затримка:',
    status_refresh: 'Перевірити знову',

    cta_title: 'Готові спілкуватися на новому рівні?',
    cta_desc: 'Завантажте клієнт NotOS для Windows безкоштовно просто зараз. Встановлення триває менше хвилини.',
    btn_download_full: 'Завантажити NotOS для Windows',
    cta_whats_new: 'Що нового у v0.5.6:',
    cta_notes: 'Миттєве видалення повідомлень в ПП та групах (0ms відгук), збереження діалогів у списку, миттєве надсилання та видалення на стіні робочого столу.',

    footer_tagline: 'Месенджер нового покоління для голосового зв’язку, дзвінків та спільного перегляду.',
    footer_rights: 'Всі права захищені.',
    footer_product: 'Продукт',
    footer_legal: 'Правова інформація',
    modal_privacy_title: 'Політика конфіденційності',
    modal_terms_title: 'Умови використання',

    privacy_body: `
      <h4>1. Загальні положення</h4>
      <p>Ця Політика конфіденційності регулює порядок обробки даних у NotOS. Ми поважаємо вашу приватність і зводимо збір даних до мінімуму.</p>
      <h4>2. Дані та сесії</h4>
      <p>Зберігаються лише дані, необхідні для авторизації та роботи кімнат. Усі файли сесій генеруються і зберігаються локально на комп’ютері.</p>
      <h4>3. Голос та трансляція</h4>
      <p>Медіапотоки передаються зашифрованими каналами WebRTC напряму. Ми не ведемо запис розмов та трансляцій екрана.</p>
    `,

    terms_body: `
      <h4>1. Прийняття умов</h4>
      <p>Користуючись NotOS, ви погоджуєтеся дотримуватися цих Умов використання.</p>
      <h4>2. Правила</h4>
      <p>Заборонено використовувати Сервіс для спаму, шкідливого ПЗ або порушення законодавства.</p>
    `
  }
};

let currentLang = 'ru';
let cachedDownloadUrl = '/updates/NotOS-Setup-0.5.2.exe';
let cachedVersion = '0.5.2';

// Apply Language
function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem('notos_lang', lang);

  // Update active button state
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Replace text
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (TRANSLATIONS[lang][key]) {
      el.innerHTML = TRANSLATIONS[lang][key];
    }
  });

  // Replace HTML bodies (modals)
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (TRANSLATIONS[lang][key]) {
      el.innerHTML = TRANSLATIONS[lang][key];
    }
  });

  // Re-format download button subtext with language
  updateDownloadButtonsUI();
}

function updateDownloadButtonsUI() {
  const heroSub = document.getElementById('heroDownloadSub');
  const ctaSub = document.getElementById('ctaDownloadSub');
  const navBadge = document.getElementById('navVersionBadge');

  if (navBadge) navBadge.textContent = `v${cachedVersion}`;

  const subtextMap = {
    ru: `Версия ${cachedVersion} • 124 МБ • Win 10/11 x64`,
    en: `Version ${cachedVersion} • 124 MB • Win 10/11 x64`,
    uk: `Версія ${cachedVersion} • 124 МБ • Win 10/11 x64`
  };

  const text = subtextMap[currentLang] || subtextMap.ru;
  if (heroSub) heroSub.textContent = text;
  if (ctaSub) ctaSub.textContent = text;

  // Set URLs
  const heroBtn = document.getElementById('heroDownloadBtn');
  const ctaBtn = document.getElementById('ctaDownloadBtn');
  if (heroBtn) heroBtn.href = cachedDownloadUrl;
  if (ctaBtn) ctaBtn.href = cachedDownloadUrl;
}

// Fetch Latest Release from Server
async function fetchReleaseInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/client/update`, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      if (data.version) {
        cachedVersion = data.version;
      }
      if (data.installerUrl) {
        cachedDownloadUrl = data.installerUrl.startsWith('http')
          ? data.installerUrl
          : `${API_BASE}${data.installerUrl.startsWith('/') ? '' : '/'}${data.installerUrl}`;
      }
      updateDownloadButtonsUI();
    }
  } catch (err) {
    console.warn('[NotOS] Could not reach update manifest, using fallback:', err);
  }
}

// Live Server Status & Latency Check
async function checkServerStatus() {
  const pingEl = document.getElementById('statusPingValue');
  const overallBadge = document.getElementById('statusOverallBadge');
  const overallText = document.getElementById('statusOverallText');
  const navStatusText = document.getElementById('navStatusText');
  const navStatusPill = document.getElementById('navStatusPill');

  const stVoice = document.getElementById('stVoice');
  const stApi = document.getElementById('stApi');
  const stUpdates = document.getElementById('stUpdates');
  const stWebrtc = document.getElementById('stWebrtc');

  const t0 = performance.now();
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET', cache: 'no-cache' });
    const latency = Math.round(performance.now() - t0);

    if (res.ok) {
      if (pingEl) pingEl.textContent = `${latency} мс`;
      if (overallBadge) {
        overallBadge.className = 'status-overall-badge';
      }
      if (overallText) overallText.textContent = TRANSLATIONS[currentLang].status_all_operational;
      if (navStatusText) navStatusText.textContent = TRANSLATIONS[currentLang].status_online;
      if (navStatusPill) navStatusPill.style.display = 'inline-flex';

      [stVoice, stApi, stUpdates, stWebrtc].forEach((el) => {
        if (el) {
          el.className = 'status-item-state state-good';
          el.textContent = currentLang === 'en' ? 'Operational' : (currentLang === 'uk' ? 'Нормально' : 'Нормально');
        }
      });
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    if (pingEl) pingEl.textContent = '—';
    if (overallBadge) {
      overallBadge.className = 'status-overall-badge';
      overallBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      overallBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      overallBadge.style.color = '#f87171';
    }
    if (overallText) overallText.textContent = TRANSLATIONS[currentLang].status_degraded;
    if (navStatusText) navStatusText.textContent = TRANSLATIONS[currentLang].status_offline;

    [stVoice, stApi, stUpdates, stWebrtc].forEach((el) => {
      if (el) {
        el.className = 'status-item-state state-warn';
        el.textContent = currentLang === 'en' ? 'Rechecking' : 'Проверка';
      }
    });
  }
}

// Live Mockup Taskbar Clock
function updateMockupClock() {
  const timeEl = document.getElementById('tbClockTime');
  const dateEl = document.getElementById('tbClockDate');
  if (!timeEl || !dateEl) return;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  timeEl.textContent = `${hours}:${minutes}`;

  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  dateEl.textContent = `${day}.${month}.${year}`;
}

// Modals Setup
function setupModals() {
  const privacyModal = document.getElementById('privacyModal');
  const termsModal = document.getElementById('termsModal');

  const openPrivacyBtn = document.getElementById('openPrivacyBtn');
  const closePrivacyBtn = document.getElementById('closePrivacyBtn');

  const openTermsBtn = document.getElementById('openTermsBtn');
  const closeTermsBtn = document.getElementById('closeTermsBtn');

  const openModal = (m) => m && m.classList.add('open');
  const closeModal = (m) => m && m.classList.remove('open');

  openPrivacyBtn?.addEventListener('click', () => openModal(privacyModal));
  closePrivacyBtn?.addEventListener('click', () => closeModal(privacyModal));

  openTermsBtn?.addEventListener('click', () => openModal(termsModal));
  closeTermsBtn?.addEventListener('click', () => closeModal(termsModal));

  // Backdrop click closes
  [privacyModal, termsModal].forEach((m) => {
    m?.addEventListener('click', (e) => {
      if (e.target === m) closeModal(m);
    });
  });

  // ESC key closes
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal(privacyModal);
      closeModal(termsModal);
    }
  });
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Setup Language Buttons
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLanguage(btn.dataset.lang);
    });
  });

  // Load saved or system language
  const saved = localStorage.getItem('notos_lang');
  const navLang = (navigator.language || 'ru').toLowerCase();
  const initLang = saved || (navLang.startsWith('uk') ? 'uk' : (navLang.startsWith('en') ? 'en' : 'ru'));
  setLanguage(initLang);

  // Setup Modals
  setupModals();

  // Mockup clock
  updateMockupClock();
  setInterval(updateMockupClock, 10000);

  // Status Refresh Button
  document.getElementById('refreshStatusBtn')?.addEventListener('click', () => {
    void checkServerStatus();
  });

  // Fetch Release Info & Check Status
  void fetchReleaseInfo();
  void checkServerStatus();

  // Periodic Status Ping every 30s
  setInterval(checkServerStatus, 30000);
});
