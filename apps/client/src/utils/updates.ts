import type { Language } from '../api/types';

export type LocalizedText = string | Partial<Record<Language, string>>;

export function getLocalizedUpdateText(
  value: LocalizedText | undefined,
  language: Language
): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[language] || value.ru || value.en || '';
}

export type AppUpdate = {
  /** Unique, never-reused identifier for this update. */
  id: string;
  /** Display version, e.g. '0.5.12'. */
  version: string;
  /** ISO date (YYYY-MM-DD) the update was released. */
  date: string;
  /** Short headline shown on the update button and at the top of the details. */
  title: LocalizedText;
  /** One-line summary shown under the title in the list. */
  summary: LocalizedText;
  /** Full details. Plain text; blank lines separate paragraphs. */
  body: LocalizedText;
  /** Optional banner image (asset URL or data URL) shown as the window header. */
  headerImage?: string;
};

// Newest update first. Old dummy entries removed.
export const UPDATES: AppUpdate[] = [
  {
    id: 'update-0.5.29',
    version: '0.5.29',
    date: '2026-10-04',
    title: {
      ru: 'Надёжная система автообновления и прямая загрузка установщика',
      en: 'Reliable Auto-Update System & Direct Installer Downloads',
      uk: 'Надійна система автооновлення та пряме завантаження інсталятора'
    },
    summary: {
      ru: 'Исправлена проблема, при которой у пользователей скачивался zip-архив вместо обновления. Установщик .exe теперь отдаётся напрямую для ручной установки и внешних загрузок, а фоновое обновление работает в 1 клик.',
      en: 'Fixed an issue where older clients would download a raw zip archive. The .exe installer is now provided directly for manual and browser downloads, and in-app hot-updating runs seamlessly in 1 click.',
      uk: 'Виправлено проблему, коли у користувачів завантажувався zip-архів замість оновлення. Інсталятор .exe тепер надається безпосередньо для ручного встановлення.'
    },
    body: {
      ru: [
        'В обновлении NotOS 0.5.29 полностью переработана и стабилизирована доставка обновлений:',
        '• Прямая загрузка установщика (.exe): если у пользователя установлена старая версия клиента без встроенного модуля автообновления, приложение больше не скачивает бесполезный zip-архив в браузер. Теперь загружается полноценный официальный установщик NotOS-Setup.exe, который обновляет систему в один клик.',
        '• Быстрое горячее обновление в 1 клик: для всех актуальных клиентов сохраняется мгновенная фоновая загрузка веб-бандла с прогресс-баром и бесшовным перезапуском.',
        '• Ручное восстановление при ошибках: если по какой-либо причине автообновление прервано, в диалоге проверки появляется кнопка «Скачать установщик вручную (.exe)» для гарантированного перехода на свежую версию.'
      ].join('\n\n'),
      en: [
        'NotOS 0.5.29 completely refines and stabilizes update delivery across all platforms:',
        '• Direct executable installer (.exe): if a user is on an older client version without the built-in hot-updater, the app no longer downloads an unpackaged zip archive into the browser. It now downloads the official NotOS-Setup.exe installer directly.',
        '• Seamless 1-click in-app updates: modern clients continue receiving instant lightweight bundle updates with progress bar and smooth auto-restarts.',
        '• Manual recovery on error: if auto-updating encounters an interruption, a clear button to download the installer manually is provided.'
      ].join('\n\n'),
      uk: [
        'В оновленні NotOS 0.5.29 повністю перероблено та стабілізовано доставку оновлень:',
        '• Пряме завантаження інсталятора (.exe): якщо у користувача встановлена попередня версія клієнта, браузер більше не завантажує zip-архів — натомість одразу завантажується офіційний NotOS-Setup.exe.',
        '• Швидке оновлення в 1 клік: для сучасних клієнтів продовжує діяти безшовне фонове оновлення.',
        '• Ручне відновлення: додано кнопку завантаження інсталятора в разі будь-яких помилок з мережею.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.28',
    version: '0.5.28',
    date: '2026-10-01',
    title: {
      ru: 'Открепление мессенджера в отдельное окно (Discord-style) и мгновенный возврат',
      en: 'Detached Messenger Standalone Window (Discord-style) & Quick Dock',
      uk: 'Відкріплення месенджера в окреме вікно (Discord-style) та швидке повернення'
    },
    summary: {
      ru: 'Возможность открепить мессенджер из рабочего стола в отдельное нативное окно как Discord. Единая сессия, звонки и WebRTC. Мгновенный возврат на рабочий стол кнопкой в шапке, закрытием окна или кликом по мессенджеру в панели задач.',
      en: 'Detach Messenger from the virtual desktop into a standalone Discord-style native window. Unified session, calls, and WebRTC. Return to desktop via titlebar dock button, window close, or taskbar icon click.',
      uk: 'Можливість відкріпити месенджер з робочого столу в окреме нативне вікно як Discord. Єдина сесія, дзвінки та WebRTC. Миттєве повернення на робочий стіл.'
    },
    body: {
      ru: [
        'В обновлении NotOS 0.5.28 появилась одна из самых ожидаемых возможностей — работа с мессенджером в отдельном нативном окне:',
        '• Открепление в стиле Discord: в шапке окна мессенджера добавлена кнопка открепления. По клику мессенджер раскрывается в собственное независимое нативное окно с темной стильной шапкой, перемещением на второй монитор, Windows Snap и полноэкранным режимом.',
        '• Единая сессия и процесс: окно остается частью того же приложения NotOS. Ваши чаты, сокеты, звонки и авторизация не сбрасываются и мгновенно продолжают работать в отдельном окне.',
        '• Мгновенный возврат на рабочий стол: вернуть мессенджер обратно можно любым удобным способом — нажатием кнопки «На рабочий стол» в шапке открепленного окна, нажатием на кнопку закрытия (✕) или кликом по иконке Мессенджера в панели задач / ярлыку на рабочем столе NotOS.',
        '• Индикатор в панели задач: на виртуальном рабочем столе иконка мессенджера показывает статус открепления и подсказку, возвращая окно на рабочий стол при первом нажатии.'
      ].join('\n\n'),
      en: [
        'NotOS 0.5.28 brings one of the most requested features — popping out the Messenger into a standalone native window:',
        '• Discord-style pop-out window: click the new Detach button in the Messenger titlebar to pull it out into its own frameless native window with full multi-monitor, Windows Snap, and maximize support.',
        '• Unified session & real-time sync: shares the exact same authenticated session, WebSockets, and WebRTC calls without any reconnects or re-logins.',
        '• Instant return to desktop: dock the Messenger back at any time via the "To Desktop" titlebar button, the close (✕) button, or by clicking the Messenger icon in the desktop taskbar / desktop shortcut.',
        '• Taskbar detached indicator: the desktop taskbar highlights the detached state and brings the Messenger right back to the virtual desktop upon click.'
      ].join('\n\n'),
      uk: [
        'У NotOS 0.5.28 з’явилась можливість відкріплення месенджера в окреме нативне вікно:',
        '• Відкріплення у стилі Discord: натисніть кнопку відкріплення у заголовку месенджера, щоб винести його в окреме нативне вікно з підтримкою другого монітора та Windows Snap.',
        '• Єдина сесія та зв’язок: збереження авторизації, чатів, дзвінків та налаштувань без повторного входу.',
        '• Миттєве повернення на робочий стіл: кнопкою у заголовку, закриттям вікна (✕) або кліком по іконці месенджера на панелі завдань.',
        '• Індикатор на панелі завдань зі швидким поверненням на робочий стіл.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.27',
    version: '0.5.27',
    date: '2026-10-01',
    title: {
      ru: 'Синхронизация доски в звонках, аудио-статусы в профиле, стикеры и виджеты',
      en: 'Call Whiteboard Live Sync, Profile Voice Bios, Desktop Stickies & Widgets',
      uk: 'Синхронізація дошки у дзвінках, аудіо-статуси у профілі, стікери та віджети'
    },
    summary: {
      ru: 'Синхронизация штрихов доски для участников, подключающихся позже; интеграция доски в голосовую сцену без закрытия при включении камеры или демонстрации; панель управления звонком всегда доступна; запись и загрузка аудио-статусов в настройках профиля; очистка интерфейса от лишних эмодзи.',
      en: 'Whiteboard stroke synchronization for peers opening later; seamless stage tile integration without closing on camera/screen share; call control pill always accessible; voice bio mic recording & file upload in profile settings; clean emoji-free styling.',
      uk: 'Синхронізація штрихів дошки для учасників, які приєднуються пізніше; інтеграція дошки у голосову сцену без закриття при увімкненні камери чи демонстрації; панель дзвінка завжди доступна; аудіо-статуси у налаштуваннях профілю.'
    },
    body: {
      ru: [
        'В обновлении NotOS 0.5.27 представлены важные улучшения звонков, личного профиля и рабочего стола:',
        '• Интерактивная доска в звонках без ограничений: если собеседник открыл доску позже вас, все ранее нарисованные штрихи автоматически синхронизируются и отображаются. Доска больше не закрывается при включении камеры или демонстрации экрана, а плавно становится плиткой LIVE на голосовой сцене с быстрым переключением фокуса в один клик.',
        '• Панель управления звонком всегда под рукой: кнопка сброса звонка, отключение микрофона, звука, камеры и демонстрации экрана зафиксированы поверх холста и никогда не перекрываются окном рисования.',
        '• Аудио-статусы (Voice Bio) в Настройках: настройте свой голосовой статус прямо в разделе Настройки → Профиль (под текстовым статусом) или в карточке профиля. Доступна запись с микрофона до 10 секунд с таймером и кнопка быстрой загрузки готового аудиофайла с устройства.',
        '• Чистый минималистичный дизайн: удалены лишние эмодзи из всех заголовков, кнопок и контекстных меню рабочего стола, заметок, виджетов и доски (сохранены только в памятных достижениях «Наша история»).',
        '• Удален PiP-режим реакций: удалены фоновые наложения веб-камер в режиме совместного просмотра Watch Together для лучшей производительности.',
        '• Цветные стикеры-записки и виджеты («Лучший друг», «Часы и погода»), капсулы времени в переписках и профиль дружбы «Наша история».'
      ].join('\n\n'),
      en: [
        'NotOS 0.5.27 brings major enhancements for calls, profile personalization, and desktop widgets:',
        '• Seamless Call Whiteboard: drawings sync automatically even if your peer opens the sketchpad later. Whiteboard no longer force-closes when turning on webcam or screen share — it stays alive as an interactive stage tile with seamless 1-click spotlight switching.',
        '• Persistent Call Controls: the call control pill (hangup, mute, deafen, camera, screen share) stays elevated at all times and is never obscured by the canvas.',
        '• Voice Bio in Settings: record or upload your voice bio directly in Settings → Profile (below status) or inside your profile card. Features 10-second mic recording with live countdown and local audio file upload.',
        '• Clean Emoji-Free Styling: removed extraneous emojis across desktop context menus, sticky notes, widgets, and whiteboard toolbar, keeping them purely for "Our Story" friendship milestones.',
        '• Removed Watch Together PiP: streamlined joint viewing without camera PiP overlays for peak performance.',
        '• Desktop Sticky Notes, Best Friend & Clock/Weather widgets, and Time Capsule messages.'
      ].join('\n\n'),
      uk: [
        'У NotOS 0.5.27 реалізовано покращення для дзвінків, профілю та робочого столу:',
        '• Інтерактивна дошка у дзвінках: повна синхронізація штрихів для тих, хто відкрив дошку пізніше; дошка не закривається при увімкненні демонстрації чи камери, а відображається плиткою LIVE.',
        '• Панель керування дзвінком зі скиданням та демонстрацією завжди доступна і не перекривається.',
        '• Аудіо-статуси у Налаштуваннях → Профіль з записом з мікрофона та завантаженням файлів.',
        '• Очищений інтерфейс без зайвих емодзі у назвах та кнопках.',
        '• Стікери та віджети робочого столу, капсули часу та «Наша історія».'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.26',
    version: '0.5.26',
    date: '2026-10-01',
    title: {
      ru: 'Стикеры и виджеты рабочего стола, Капсулы времени, «Наша история», Интерактивная доска в звонках и Аудио-статусы',
      en: 'Desktop Sticky Notes & Widgets, Time Capsules, Our Story, Live Call Whiteboard & Voice Bios',
      uk: 'Стікери та віджети робочого столу, Капсули часу, «Наша історія», Інтерактивна дошка у дзвінках та Аудіо-статуси'
    },
    summary: {
      ru: 'Масштабный апдейт для рабочего стола и личных пространств: интерактивные цветные стикеры, виджеты «Лучший друг» и «Часы и погода», секретные капсулы времени с таймером обратного отсчета в ЛС, вехи дружбы «Наша история», живая интерактивная доска в звонках и аудио-статусы в профилях!',
      en: 'Major desktop & 1-on-1 spaces update: draggable sticky notes, Best Friend & Clock/Weather widgets, countdown time capsules in DMs, Our Story friendship profile, live synchronized whiteboard in calls, and voice bio snippets in profile cards!',
      uk: 'Масштабний апдейт для робочого столу та особистих просторів: інтерактивні кольорові стікери, віджети «Найкращий друг» та «Годинник і погода», секретні капсули часу з таймером зворотного відліку у ПП, віхи дружби «Наша історія», жива інтерактивна дошка у дзвінках та аудіо-статуси у профілях!'
    },
    body: {
      ru: [
        'В этом масштабном обновлении реализованы 6 ключевых нововведений для Рабочего стола и личных коммуникаций:',
        '• Интерактивные стикеры-записки на рабочем столе: перетаскивайте заметки в любую точку стола, выбирайте цвет из палитры (желтый, розовый, голубой, зеленый, фиолетовый, темный), закрепляйте булавкой. Все записки сохраняются автоматически.',
        '• Модульные виджеты: добавлены виджет «Лучший друг» (быстрый статус, аватар, 1 клик для звонка или чата) и виджет «Часы и погода» (динамическое приветствие, точные часы с секундами, дата, прогноз погоды и переключение °C/°F). Доступны через меню «Виджет» на рабочем столе.',
        '• Капсулы времени в ЛС: запечатывайте послания и сюрпризы до определенной даты (завтра, через 3 дня, через неделю, на Новый Год или в выбранное время). До наступления срока сообщение защищено голографическим щитом с живым таймером обратного отсчета.',
        '• «Наша история» в ЛС: откройте историю дружбы прямо из шапки диалога — совместные дни, счетчик сообщений, архив медиафайлов, статистика ночных бесед и разблокированные достижения дружбы.',
        '• Совместная интерактивная доска в звонках: рисуйте вместе в реальном времени во время звонка 1-на-1 с неоновой палитрой, настройкой толщины кисти, ластиком и живым курсором собеседника.',
        '• Аудио-статусы в профиле: записывайте голосовые визитки до 10 секунд с живой индикацией волн и таймером, слушайте аудио-статусы друзей в один клик.'
      ].join('\n\n'),
      en: [
        'This major update delivers 6 powerful features for Desktop and personal interactions:',
        '• Desktop Sticky Notes: draggable, customizable color notes on your desktop canvas with palette choices, pin lock, and auto-save.',
        '• Modular Desktop Widgets: "Best Friend" card (instant presence, 1-click chat/call) and "Clock & Weather" glassmorphic widget with dynamic greetings and °C/°F toggle. Accessible via Desktop Right-Click > Widget.',
        '• Time Capsule Messages in DMs: seal secret messages and surprises until a designated future date. Displays a sleek holographic locked capsule with a live ticking countdown timer.',
        '• "Our Story" Friendship Milestones: explore your friendship stats from the chat header — days together, exchanged messages breakdown, media archive, night talks, and unlocked friendship badges.',
        '• Live Call Whiteboard: real-time synchronized sketchpad during 1-on-1 calls featuring neon colors, brush size controls, eraser, and peer cursor tracking.',
        '• Voice Bio Snippets: record and play up to 10-second voice bios with animated sound wave equalizers directly on profile cards.'
      ].join('\n\n'),
      uk: [
        'У цьому масштабному оновленні реалізовано 6 ключових нововведень для Робочого столу та особистих комунікацій:',
        '• Інтерактивні стікери-записки на робочому столі: перетягуйте нотатки, обирайте колір, закріплюйте шпилькою з автозбереженням.',
        '• Модульні віджети: додано віджет «Найкращий друг» та «Годинник і погода» з динамічним привітанням та погодою.',
        '• Капсули часу у ПП: запечатуйте послання до визначеної дати з живим таймером зворотного відліку.',
        '• «Наша історія» у ПП: історія дружби з підрахунком днів, повідомлень, медіа та спільних досягнень.',
        '• Спільна інтерактивна дошка у дзвінках: малюйте разом у реальному часі під час 1-на-1 дзвінків.',
        '• Аудіо-статуси у профілі: записуйте голосові статуси до 10 секунд з анімацією звукових хвиль.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.25',
    version: '0.5.25',
    date: '2026-10-01',
    title: {
      ru: 'Редизайн шапки групп, исправление шрифтов Noto Sans и кнопок',
      en: 'Group Header Redesign, Noto Sans Font Fix & Button Styling',
      uk: 'Редизайн шапки груп, виправлення шрифтів Noto Sans та кнопок'
    },
    summary: {
      ru: 'В шапке группы теперь пишется название группы и канала с иконками (# для текста, 🔊 для голосовых, 📢 для ленты). Исправлены шрифты, жирность, скругления кнопок и сокращение кнопки «Непрочитанные».',
      en: 'Group header now displays group and channel names with proper icons (# for text, 🔊 for voice, 📢 for feed). Fixed Noto Sans font weights, button border-radius inconsistencies, and unread button truncation.',
      uk: 'У шапці групи тепер відображається назва групи та каналу з іконками (# для тексту, 🔊 для голосових, 📢 для стрічки). Виправлено шрифти, жирність, радіуси кнопок та скорочення кнопки «Непрочитані».'
    },
    body: {
      ru: [
        'В этом обновлении исправлены визуальные недочеты, дизайн элементов и шрифты:',
        '• Шапка групп: теперь сверху всегда пишется «Название группы — #канал», а для голосовых каналов отображается значок динамика 🔊 вместо решетки #.',
        '• Кнопки действий: утилитарные кнопки шапки (поиск, закрепленные сообщения, саммари, список участников) приведены к единому компактному дизайну без синего фона звонка.',
        '• Шрифты и жирность: включен синтетический Bold для Noto Sans, предотвращающий подмену шрифта на системный Segoe UI/Arial в жирных заголовках и кнопках.',
        '• Кнопка «Непрочитанные»: длинный текст фильтра теперь корректно и плавно сокращается с троеточием без деформации соседних кнопок.',
        '• Дизайн кнопок: унифицированы радиусы скругления (8px), исправлены кнопки кастомизации профиля и удаление групп, устранены дергания текста каналов при наведении.'
      ].join('\n\n'),
      en: [
        'This update fixes visual inconsistencies, element styling, and typography:',
        '• Group Header: now always displays "Group Name — #channel", and voice channels feature a speaker icon 🔊 instead of the # hashtag.',
        '• Header Action Buttons: utility buttons (search, pinned messages, AI recap, member list) unified to sleek compact icons without the solid blue call button look.',
        '• Fonts & Weights: enabled synthetic bold for Noto Sans to prevent browser fallback to Segoe UI/Arial in bold headings and buttons.',
        '• "Unread" Filter Button: long filter text now cleanly truncates with an ellipsis without squishing adjacent buttons.',
        '• Button Consistency: unified 8px border-radius across modals, fixed server customization button, and eliminated text jitter on channel hover.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні виправлено візуальні недоліки, дизайн елементів та шрифти:',
        '• Шапка груп: тепер зверху завжди пишеться «Назва групи — #канал», а для голосових каналів відображається значок динаміка 🔊 замість решітки #.',
        '• Кнопки дій: утилітарні кнопки шапки (пошук, закріплені повідомлення, самарі, список учасників) приведені до єдиного компактного дизайну без синього фону дзвінка.',
        '• Шрифти та жирність: увімкнено синтетичний Bold для Noto Sans, що запобігає підміні шрифту на системний Segoe UI/Arial у жирних заголовках та кнопках.',
        '• Кнопка «Непрочитані»: довгий текст фільтра тепер коректно та плавно скорочується з трикрапкою без деформації сусідніх кнопок.',
        '• Дизайн кнопок: уніфіковано радіуси скруглення (8px), виправлено кнопки кастомізації профілю та видалення груп, усунено смикання тексту каналів під час наведення.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.24',
    version: '0.5.24',
    date: '2026-09-29',
    title: {
      ru: 'Мгновенная загрузка мессенджера, чатов и групп при запуске',
      en: 'Instant Messenger, Chat & Group Loading on Startup',
      uk: 'Миттєве завантаження месенджера, чатів та груп при запуску'
    },
    summary: {
      ru: 'Оптимизирована скорость запуска программы: список друзей, переписки, группы, роли и сообщения отображаются мгновенно без ожидания и подвисаний.',
      en: 'Optimized app startup speed: friends list, chats, groups, roles, and message history appear instantly without waiting or freezing.',
      uk: 'Оптимізовано швидкість запуску програми: список друзів, листування, групи, ролі та повідомлення відображаються миттєво без очікування та зависань.'
    },
    body: {
      ru: [
        'В этом обновлении значительно ускорена загрузка мессенджера и чатов при запуске программы:',
        '• Мгновенный запуск мессенджера: список друзей, личных диалогов и серверов теперь сохраняется локально и отображается с первой миллисекунды открытия окна, пока актуальные данные обновляются в фоне.',
        '• Быстрое открытие групп: каналы, участники, роли и последние сообщения чатов теперь загружаются сразу из локального кэша, устраняя пустые экраны и мигание при переходе.',
        '• Фоновая синхронизация: данные мессенджера подгружаются заранее в фоновом режиме сразу при входе в систему.',
        '• Оптимизация сервера и базы данных: параллельная обработка каналов и ускоренные индексы сделали синхронизацию сообщений и списка чатов многократно быстрее.'
      ].join('\n\n'),
      en: [
        'This update significantly speeds up messenger and chat loading on application startup:',
        '• Instant Messenger Launch: friends list, direct conversations, and servers are now stored locally and appear from the very first frame, while fresh data syncs in the background.',
        '• Fast Group Loading: channels, members, roles, and recent chat messages load immediately from the local cache, eliminating empty screens and layout flicker.',
        '• Background Sync: messenger data is prefetched in the background right after logging in.',
        '• Server & Database Optimizations: parallel channel querying and optimized database indexes make history and conversation sync much faster.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні значно прискорено завантаження месенджера та чатів під час запуску програми:',
        '• Миттєвий запуск месенджера: список друзів, особистих діалогів та серверів тепер зберігається локально та відображається з першої мілісекунди відкриття вікна, поки актуальні дані оновлюються у фоні.',
        '• Швидке відкриття груп: канали, учасники, ролі та останні повідомлення чатів тепер завантажуються одразу з локального кешу, усуваючи порожні екрани та мерехтіння.',
        '• Фонова синхронізація: дані месенджера підвантажуються заздалегідь у фоновому режимі одразу під час входу в систему.',
        '• Оптимізація сервера та бази даних: паралельна обробка каналів та прискорені індекси зробили синхронізацію повідомлень та списку чатів у рази швидшою.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.23',
    version: '0.5.23',
    date: '2026-09-29',
    title: {
      ru: 'Исправление меню «Правописание» и быстрое исправление ошибок',
      en: 'Spelling Menu Fix & Instant Word Corrections',
      uk: 'Виправлення меню «Правопис» та швидке виправлення помилок'
    },
    summary: {
      ru: 'Исправлено отображение контекстного меню «Правописание ›» с вариантами исправлений при правом клике по словам с ошибками, добавлен встроенный словарь частых опечаток.',
      en: 'Fixed display of Spelling context submenu with corrections when right-clicking misspelled words, and added built-in dictionary for common typos.',
      uk: 'Виправлено відображення контекстного меню «Правопис ›» з варіантами виправлень при правому кліку по словах з помилками, додано вбудований словник частих друкарських помилок.'
    },
    body: {
      ru: [
        'В этом обновлении исправлена работа контекстного меню проверки правописания при вводе сообщений:',
        '• Меню «Правописание»: теперь при правом клике по подчёркнутому или ошибочному слову гарантированно открывается подменю «Правописание ›» с предложенными вариантами правильного написания и кнопкой «Игнорировать слово».',
        '• Быстрые подсказки: встроен словарь частых опечаток для мгновенного предложения исправлений в один клик.'
      ].join('\n\n'),
      en: [
        'This update fixes the spelling context menu in the message composer:',
        '• Spelling Submenu: right-clicking any misspelled word reliably shows the "Spelling ›" submenu with suggestions and an "Ignore word" action.',
        '• Instant Suggestions: built-in typo dictionary provides immediate corrections in a single click.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні виправлено роботу контекстного меню перевірки правопису під час введення повідомлень:',
        '• Меню «Правопис»: тепер при правому кліку по підкресленому або помилковому слову гарантовано відкривається підменю «Правопис ›» з варіантами правильного написання та кнопкою «Ігнорувати слово».',
        '• Швидкі підказки: вбудовано словник частих друкарських помилок для миттєвого виправлення в один клік.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.22',
    version: '0.5.22',
    date: '2026-09-29',
    title: {
      ru: 'Проверка правописания и иконка голосовых каналов',
      en: 'Spell Check & Voice Channel Header Icon',
      uk: 'Перевірка правопису та іконка голосових каналів'
    },
    summary: {
      ru: 'Автоматическая проверка орфографии с красным волнистым подчёркиванием и меню исправления, а также иконка динамика для голосовых каналов в шапке.',
      en: 'Automatic spellcheck with wavy red underlines and spelling suggestions context menu, plus speaker icon for voice channels in group header.',
      uk: 'Автоматична перевірка орфографії з червоним хвилястим підкресленням та меню виправлення, а також іконка динаміка для голосових каналів у шапці.'
    },
    body: {
      ru: [
        'В этом обновлении добавлены проверка орфографии при вводе сообщений и улучшено отображение каналов в группах.',
        '• Проверка правописания: слова с ошибками подчёркиваются красной волнистой линией. При клике правой кнопкой мыши по слову открывается меню «Правописание» с предложенными исправлениями и кнопкой «Игнорировать слово».',
        '• Иконка голосового канала: если вы находитесь в голосовом канале группы, в верхней шапке мессенджера он отображается с аккуратной иконкой динамика вместо символа решётки.'
      ].join('\n\n'),
      en: [
        'This update introduces inline spellchecking and refined channel indicators.',
        '• Inline spellcheck: misspelled words are highlighted with a wavy red underline. Right-clicking a word opens a Spelling submenu with corrections and an Ignore word option.',
        '• Voice channel icon: when connected to or viewing a voice channel, the group title displays a speaker icon instead of a hashtag.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні додано перевірку орфографії під час введення повідомлень та покращено відображення каналів у групах.',
        '• Перевірка правопису: слова з помилками підкреслюються червоною хвилястою лінією. При кліку правою кнопкою миші по слову відкривається меню «Правопис» з варіантами виправлень і кнопкою «Ігнорувати слово».',
        '• Іконка голосового каналу: якщо ви перебуваєте в голосовому каналі групи, у верхній шапці месенджера він відображається з іконкою динаміка замість решітки.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.21',
    version: '0.5.21',
    date: '2026-09-29',
    title: {
      ru: 'Отображение текущего канала группы и аккуратное сокращение вкладок',
      en: 'Group Channel Header Indicator & Clean Tab Truncation',
      uk: 'Відображення поточного каналу групи та акуратне скорочення вкладок'
    },
    summary: {
      ru: 'В заголовке окна группы теперь отображается название текущего канала, а длинные названия фильтров чатов аккуратно сокращаются с многоточием.',
      en: 'Group window header now displays the active channel name, and chat filter buttons cleanly truncate with an ellipsis when space is constrained.',
      uk: 'У заголовку вікна групи тепер відображається назва поточного каналу, а довгі назви фільтрів чатів акуратно скорочуються з трикрапкою.'
    },
    body: {
      ru: [
        'В этом обновлении улучшена навигация по группам и отображение элементов интерфейса.',
        '• Канал в заголовке группы: в верхней части окна мессенджера рядом с названием группы теперь отображается выбранный текстовый или голосовой канал через дефис и решётку (например, Название - #general).',
        '• Аккуратное сокращение вкладок: кнопка непрочитанных сообщений и другие вкладки фильтров при нехватке места плавно сокращаются с многоточием в конце, не налезая на соседние кнопки, и снабжены всплывающими подсказками с полным текстом.'
      ].join('\n\n'),
      en: [
        'This update refines group navigation and interface element sizing.',
        '• Channel indicator in group header: the top window title now displays the active text or voice channel alongside the group name (e.g. Group Name - #general).',
        '• Clean filter tab truncation: unread and archive filter buttons now cleanly truncate with an ellipsis when space is constrained, with full tooltips on hover.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні покращено навігацію по групах та відображення елементів інтерфейсу.',
        '• Канал у заголовку групи: у верхній частині вікна месенджера поруч із назвою групи тепер відображається обраний канал через дефіс та решітку (наприклад, Назва - #general).',
        '• Акуратне скорочення вкладок: кнопка непрочитаних повідомлень та інші вкладки фільтрів при нестачі місця плавно скорочуються з трикрапкою, не накладаючись на сусідні кнопки.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.20',
    version: '0.5.20',
    date: '2026-09-29',
    title: {
      ru: 'Улучшение фона и оформления панели ввода в чатах',
      en: 'Enhanced Input Panel & Text Field Background in Chats',
      uk: 'Покращення фону та оформлення панелі введення в чатах'
    },
    summary: {
      ru: 'Панель и поле ввода во всех чатах получили цельное оформление с фоновой панелью и четким контрастным контуром по аналогии с ИИ-чатом.',
      en: 'Compose bars and text input fields across all chats now feature full themed panel backgrounds and cohesive styling matching the AI chat.',
      uk: 'Панель та поле введення у всіх чатах отримали цілісне оформлення з фоновою панеллю та чітким контуром за аналогією з ШІ-чатом.'
    },
    body: {
      ru: [
        'В этом обновлении усовершенствовано оформление области ввода сообщений во всех чатах.',
        '• Фон панели отправки сообщений: нижняя панель ввода теперь имеет цельный фоновый цвет темы приложения, исключая эффект пустоты под полем ввода.',
        '• Контрастный контур и фон поля ввода: текстовое поле оформлено четким аккуратным блоком с фоном темы и акцентной подсветкой при наборе текста.',
        '• Горизонтальное расположение кнопок: иконки голосовых сообщений, GIF и эмодзи аккуратно выстроены слева направо внутри правой части поля ввода.'
      ].join('\n\n'),
      en: [
        'This update improves the compose area styling across all chat interfaces.',
        '• Themed composer background: the bottom message compose bar now features a solid theme panel background instead of transparency.',
        '• High-contrast input pill: the message field uses a distinct theme background, clean border, and accent focus highlights.',
        '• Horizontal in-box actions: voice recording, GIF, and emoji buttons remain neatly arranged in a horizontal row inside the input field.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні вдосконалено оформлення області введення повідомлень у всіх чатах.',
        '• Фон панелі надсилання повідомлень: нижня панель введення тепер має цілісний фоновий колір теми застосунку.',
        '• Контрастний контур та фон поля введення: текстове поле оформлене чітким акуратним блоком з фоном теми та акцентною підсвіткою при наборі.',
        '• Горизонтальне розташування кнопок: іконки голосових повідомлень, GIF та емодзі акуратно вишикувані зліва направо всередині поля введення.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.19',
    version: '0.5.19',
    date: '2026-09-29',
    title: {
      ru: 'Интеграция эмодзи, GIF и голосовых сообщений внутрь поля ввода в чатах',
      en: 'In-Box Emoji, GIFs & Voice Messages in All Chats',
      uk: 'Інтеграція емодзі, GIF та голосових повідомлень у поле введення в чатах'
    },
    summary: {
      ru: 'Кнопки эмодзи, GIF-анимаций и записи голосовых сообщений теперь расположены непосредственно внутри поля ввода во всех чатах приложения, сохраняя единый аккуратный стиль с поддержкой тем оформления.',
      en: 'Emoji, GIF, and voice message buttons are now integrated directly inside the text input box across all chat views in the app with theme-consistent styling.',
      uk: 'Кнопки емодзі, GIF-анімацій та запису голосових повідомлень тепер розташовані безпосередньо всередині поля введення в усіх чатах застосунку, зберігаючи єдиний акуратний стиль з підтримкою тем оформлення.'
    },
    body: {
      ru: [
        'В этом обновлении интерфейс чатов стал еще более аккуратным, цельным и удобным.',
        '• Кнопки внутри поля ввода: иконки выбора смайликов, GIF-анимаций и записи голосовых сообщений / видеокружков теперь расположены непосредственно внутри поля ввода в личных переписках, групповых каналах и чатах голосовых комнат.',
        '• Единый стиль поля ввода: текстовый блок оформлен как единый контур с фоном и границей текущей темы приложения, а также плавной акцентной подсветкой при наборе текста.',
        '• Запись голосовых сообщений: таймер и управление записью голосовых сообщений и видеокружков теперь гармонично разворачиваются прямо поверх поля ввода.'
      ].join('\n\n'),
      en: [
        'This update brings a cleaner, unified compose experience across all chat channels.',
        '• In-box action buttons: Emoji picker, GIF search, and voice/video recording controls are now housed cleanly inside the text input box in DMs, group channels, and voice call text chats.',
        '• Cohesive input design: the compose field presents a single unified surface matching your active theme with smooth focus accent borders.',
        '• Seamless recording bar: recording duration, lock, and cancel controls now overlay cleanly inside the input container.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні інтерфейс чатів став ще акуратнішим, ціліснішим та зручнішим.',
        '• Кнопки всередині поля введення: іконки вибору емодзі, GIF-анімацій та запису голосових повідомлень / відеокружків тепер розташовані безпосередньо всередині поля введення в особистих повідомленнях, групах та голосових кімнатах.',
        '• Єдиний стиль поля введення: текстовий блок оформлений як єдиний контур з фоном обраної теми застосунку та плавною акцентною підсвіткою при фокусі.',
        '• Запис голосових повідомлень: таймер і керування записом голосових повідомлень плавно відкриваються прямо поверх поля введення.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.17',
    version: '0.5.17',
    date: '2026-09-29',
    title: {
      ru: 'Интеграция эмодзи в поле ввода и интерактивные никнеймы в Watch Together',
      en: 'In-Box Emoji/GIFs & Interactive Nicknames in Watch Together',
      uk: 'Інтеграція емодзі у поле введення та інтерактивні нікнейми у Watch Together'
    },
    summary: {
      ru: 'Кнопки эмодзи и GIF перенесены внутрь поля ввода в чате совместного просмотра по аналогии с ИИ-чатом, а никнеймы участников теперь отображают персональные стили оформления и открывают профиль при клике.',
      en: 'Emoji and GIF buttons moved inside the chat input box like in AI chat, and participant nicknames now display customized styling and open profiles on click.',
      uk: 'Кнопки емодзі та GIF перенесені всередину поля введення у чаті спільного перегляду за аналогією з ШІ-чатом, а нікнейми учасників тепер відображають персональні стилі оформлення та відкривають профіль при кліку.'
    },
    body: {
      ru: [
        'В этом обновлении совместный просмотр видео стал еще удобнее и интерактивнее.',
        '• Эмодзи и GIF внутри поля ввода: кнопки выбора смайликов и GIF-анимаций в чате Watch Together теперь гармонично расположены прямо внутри текстового поля, точно как в ИИ-чате.',
        '• Персональные стили никнеймов: имена участников в чате комнаты, списке зрителей и очереди воспроизведения теперь отображаются с выбранными ими шрифтами, цветами и визуальными эффектами.',
        '• Кликабельные профили: при нажатии на никнейм или аватар любого участника в чате, списке участников или очереди видео мгновенно открывается его карточка профиля.'
      ].join('\n\n'),
      en: [
        'This update brings a cleaner compose experience and interactive profiles to Watch Together.',
        '• In-box Emoji and GIF buttons: emoji and GIF picker triggers are now seamlessly housed inside the chat compose input shell, matching the layout of the AI chat.',
        '• Custom Nickname Styles: member nicknames across room chat, viewer list, and video queue now render with their personalized fonts, effects, and colors.',
        '• Clickable User Profiles: clicking any participant\'s avatar or nickname opens their full profile card directly from the Watch Together window.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні спільний перегляд відео став ще зручнішим та інтерактивнішим.',
        '• Емодзі та GIF всередині поля введення: кнопки вибору смайликів та GIF-анімацій у чаті Watch Together тепер гармонійно розташовані безпосередньо всередині текстового поля, точно як у ШІ-чаті.',
        '• Персональні стилі нікнеймів: імена учасників у чаті кімнати, списку глядачів та черзі відтворення тепер відображаються з обраними ними шрифтами, кольорами та візуальними ефектами.',
        '• Клікабельні профілі: при натисканні на нікнейм або аватар будь-якого учасника у чаті, списку учасників або черзі відео миттєво відкривається його картка профілю.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.16',
    version: '0.5.16',
    date: '2026-09-29',
    title: {
      ru: 'Адаптивный дизайн очереди Watch Together и исправление окна обновлений',
      en: 'Watch Together Queue Theming & Update Dialog Layout Fix',
      uk: 'Адаптивний дизайн черги Watch Together та виправлення вікна оновлень'
    },
    summary: {
      ru: 'Устранено смещение рабочего стола при проверке обновлений, добавлена адаптация очереди Watch Together под все темы оформления и обновлен фон текстового поля в чате комнаты.',
      en: 'Fixed desktop shift when checking for updates, added multi-theme support to the Watch Together queue drawer, and styled the room chat message input box.',
      uk: 'Усунуто зсув робочого столу при перевірці оновлень, додано адаптацію черги Watch Together під усі теми оформлення та оновлено фон текстового поля в чаті кімнати.'
    },
    body: {
      ru: [
        'В этом обновлении исправлены нюансы интерфейса и улучшена гармоничность оформления совместного просмотра видео.',
        '• Стабильность окна обновлений: при нажатии на кнопку проверки обновлений в шапке приложения фон и рабочий стол больше не смещаются вверх.',
        '• Темы оформления очереди Watch Together: панель очереди видео теперь плавно подстраивается под активную тему оформления — серую, мятную, океан, темную или системно-черную.',
        '• Единый стиль поля ввода в чате Watch Together: поле ввода сообщений в комнате совместного просмотра получило аккуратное фоновое оформление и рамку в едином стиле NotOS.'
      ].join('\n\n'),
      en: [
        'This update fixes UI layout shifts and improves theme consistency in Watch Together.',
        '• Stable Update Dialog: clicking the update button in the application title bar no longer causes the desktop background or windows to jump upward.',
        '• Themed Watch Together Queue: the video queue drawer now adapts naturally to all available themes, including Grey, Mint, Ocean, Dark, and System Black.',
        '• Cohesive Room Chat Compose Bar: the text message compose field in Watch Together rooms now features the standard NotOS input background, border, and styling.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні виправлено нюанси інтерфейсу та покращено гармонійність оформлення спільного перегляду відео.',
        '• Стабільність вікна оновлень: при натисканні на кнопку перевірки оновлень у шапці програми фон і робочий стіл більше не зміщуються вгору.',
        '• Теми оформлення черги Watch Together: панель черги відео тепер плавно підлаштовується під активну тему оформлення — сіру, м\'ятну, океан, темну або системно-чорну.',
        '• Єдиний стиль поля введення в чаті Watch Together: поле введення повідомлень у кімнаті спільного перегляду отримало охайне фонове оформлення та рамку в єдиному стилі NotOS.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.15',
    version: '0.5.15',
    date: '2026-09-28',
    title: {
      ru: 'Отображение камеры и звука в голосовых каналах, исправление Push-to-Talk',
      en: 'Voice Channel Camera & Sound Indicators, Push-to-Talk Polish',
      uk: 'Відображення камери та звуку в голосових каналах, виправлення Push-to-Talk'
    },
    summary: {
      ru: 'Индикаторы активной камеры и выключенного звука в списке участников, естественный цвет иконки демонстрации экрана и блокировка Push-to-Talk при выключенном микрофоне.',
      en: 'Active camera and deafened indicators in participant lists, natural green icon for screen sharing, and Push-to-Talk prevention when microphone is muted.',
      uk: 'Індикатори активної камери та вимкненого звуку у списку учасників, природний колір іконки демонстрації екрана та блокування Push-to-Talk при вимкненому мікрофоні.'
    },
    body: {
      ru: [
        'В этом обновлении улучшено визуальное отображение статусов участников голосовых каналов и поведение передачи голоса по кнопке.',
        '• Индикация активной веб-камеры: если кто-то из участников голосового канала включил камеру, рядом с его именем отображается значок камеры.',
        '• Индикатор выключенного звука: если участник выключил наушники или звук, рядом с его именем отображается понятный значок выключенного звука.',
        '• Естественный цвет демонстрации экрана: иконка трансляции экрана теперь всегда отображается привычным приятным зеленым цветом и больше не перекрашивается в красный при выборе красного акцента оформления.',
        '• Надежная работа Push-to-Talk: если ваш микрофон выключен или отключен звук, режим Push-to-Talk больше не активирует микрофон, не передает голос и не воспроизводит звуковые сигналы при нажатии назначенной клавиши.'
      ].join('\n\n'),
      en: [
        'This update improves participant status indicators in voice channels and refines push-to-talk microphone behavior.',
        '• Live camera indicator: when any participant turns on their webcam, a camera icon is displayed next to their name in the voice channel.',
        '• Deafened indicator: when someone disables their headphones or sound, a red deafened icon appears next to their name.',
        '• Natural screen share color: the screen share indicator now always uses a distinct green color and never turns red when red accent color is selected in settings.',
        '• Push-to-Talk safety: when your microphone is muted or deafened, pressing the Push-to-Talk hotkey will not transmit audio or play activation sounds.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні вдосконалено візуальне відображення статусів учасників голосових каналів та поведінку Push-to-Talk.',
        '• Індикація активної камери: якщо учасник увімкнув камеру, поруч з його ім\'ям відображається значок камери.',
        '• Індикатор вимкненого звуку: якщо учасник вимкнув звук/навушники, поруч відображається значок перекреслених навушників.',
        '• Природний колір демонстрації екрана: іконка трансляції екрана тепер завжди має приємний зелений колір і не стає червоною при виборі червоного акценту.',
        '• Безпечний Push-to-Talk: якщо мікрофон вимкнено, натискання клавіші Push-to-Talk не передає голос і не видає звукових сигналів.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.14',
    version: '0.5.14',
    date: '2026-09-28',
    title: {
      ru: 'Веб-камера в звонках, очередь Watch Together и улучшения',
      en: 'Webcam in Calls, Watch Together Queue & UI Polish',
      uk: 'Вебкамера у дзвінках, черга Watch Together та покращення'
    },
    summary: {
      ru: 'Поддержка веб-камеры в звонках и комнатах, очередь видео в Watch Together, отправка по Enter и переход на рабочий стол.',
      en: 'Webcam support in 1-on-1 and group calls, video queue in Watch Together, wall posting on Enter, and profile desktop visit.',
      uk: 'Підтримка вебкамери у дзвінках і кімнатах, черга відео у Watch Together, публікація на стіні за Enter та перехід на робочий стіл.'
    },
    body: {
      ru: [
        'В этом масштабном обновлении появились долгожданные видеозвонки с веб-камерой, очередь воспроизведения в совместном просмотре и удобные улучшения интерфейса.',
        '• Веб-камера в звонках: теперь в личных голосовых звонках и в групповых голосовых комнатах можно включать и отключать веб-камеру одной кнопкой. Видеопоток плавно масштабируется и отображается прямо в карточке участника.',
        '• Очередь видео в Watch Together: появилась возможность составлять очередь роликов. Список удобно открывается по кнопке в верхней панели. Для каждого видео показано название, превью и компактная ссылка, при клике на которую адрес копируется в буфер обмена. По завершении ролика следующий запускается автоматически.',
        '• Публикация на стене по Enter: форма отправки записей на стене профиля стала чище и удобнее — лишняя кнопка отправки убрана, а публикация выполняется мгновенно нажатием клавиши Enter.',
        '• Переход на рабочий стол из профиля: при правом клике на карточку профиля собеседника или через меню с тремя точками теперь всегда надежно доступен пункт перехода на его персональный рабочий стол.'
      ].join('\n\n'),
      en: [
        'This major update introduces webcam video in calls, playback queue in Watch Together, and interface refinements.',
        '• Webcam in calls: you can now toggle your camera in both direct calls and group voice channels with one click. Video feeds display seamlessly within participant tiles.',
        '• Watch Together video queue: organize upcoming videos in an intuitive slide-out queue drawer. Each item shows a thumbnail preview, title, and shortened link that copies on click. Next videos play automatically when the current one finishes.',
        '• Profile wall posting on Enter: simplified wall message input by removing the redundant submit button — send posts instantly with Enter.',
        '• Desktop visit from profile: right-clicking any user profile card or using the header menu reliably offers quick access to their personal desktop.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні додано підтримку вебкамери у дзвінках, чергу відео у Watch Together та зручні покращення інтерфейсу.',
        '• Вебкамера у дзвінках: вмикайте та вимикайте камеру в особистих дзвінках і групових кімнатах в один клік. Відео плавно відображається у картці учасника.',
        '• Черга відео у Watch Together: додавайте ролики до черги з прев\'ю, назвою та коротким посиланням, що копіюється при натисканні. Наступне відео вмикається автоматично.',
        '• Відправка на стіні за Enter: видалено зайву кнопку відправки, записи публікуються миттєво за клавішею Enter.',
        '• Перехід на робочий стіл: правий клік по профілю надійно відкриває перехід на персональний стіл користувача.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.13',
    version: '0.5.13',
    date: '2026-09-28',
    title: {
      ru: 'Официальные документы и журнал обновлений',
      en: 'Official Legal Documents & Updates Center',
      uk: 'Офіційні документи та журнал оновлень'
    },
    summary: {
      ru: 'Политика конфиденциальности и условия как на сайте, обновленный журнал изменений и улучшение звонков.',
      en: 'Website-matched Privacy Policy and Terms, updated changelog center, and call improvements.',
      uk: 'Політика конфіденційності та умови як на сайті, оновлений журнал змін та покращення дзвінків.'
    },
    body: {
      ru: [
        'В этом обновлении мы добавили официальные документы приватности и полностью обновили журнал изменений рабочего стола.',
        '• Политика конфиденциальности и Условия использования: в настройки добавлена полная официальная редакция документов, полностью идентичная сайту notos.tech.',
        '• Журнал обновлений рабочего стола: обновлен ярлык «Обновления» — теперь здесь собраны подробные и понятные описания всех ключевых возможностей последних версий NotOS.',
        '• Упрощенная регулировка громкости: по правому клику на собеседника в голосовых звонках и комнатах оставлен только удобный ползунок с процентами громкости (от 0% до 200%).',
        '• Быстрое автообновление в 1 клик: устранена ошибка при загрузке обновлений внутри приложения, новые версии устанавливаются стабильно и плавно.'
      ].join('\n\n'),
      en: [
        'This release adds official privacy documents and revamps the desktop changelog center.',
        '• Privacy Policy & Terms of Service: full official texts matching notos.tech are now available in application settings.',
        '• Desktop Updates Center: the "Updates" shortcut now features clear, user-focused descriptions of all features from recent releases.',
        '• Streamlined user volume: right-clicking any participant opens a clean slider with percentage display (0%–200%).',
        '• Seamless 1-click updates: fixed in-app downloader so updates install reliably without errors.'
      ].join('\n\n'),
      uk: [
        'У цьому випуску додано офіційні документи приватності та оновлено журнал змін.',
        '• Політика конфіденційності та Умови використання: додано повні тексти, ідентичні сайту notos.tech.',
        '• Журнал оновлень: ярлик «Оновлення» містить зрозумілі описи нововведень останніх версій NotOS.',
        '• Зручне налаштування гучності: за правим кліком на співрозмовника доступний повзунок від 0% до 200%.',
        '• Надійне автооновлення: виправлено завантаження оновлень усередині програми.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.12',
    version: '0.5.12',
    date: '2026-09-28',
    title: {
      ru: 'Стабильность обновлений и удобство громкости',
      en: 'Update Stability & Volume Polish',
      uk: 'Стабільність оновлень та зручність гучності'
    },
    summary: {
      ru: 'Исправлена загрузка обновлений в один клик и упрощено меню громкости собеседников.',
      en: 'Fixed one-click update downloader and simplified user volume popover.',
      uk: 'Виправлено завантаження оновлень в один клік та спрощено меню гучності співрозмовників.'
    },
    body: {
      ru: [
        'В этом обновлении мы улучшили работу встроенного механизма обновлений и доработали интерфейс звонков.',
        '• Быстрое автообновление в 1 клик: устранена ошибка при проверке и загрузке новых версий внутри приложения. Теперь клиент обновляется плавно, быстро и без сбоев.',
        '• Упрощенная настройка громкости: по правому клику на собеседника в голосовом канале или звонке открывается аккуратное компактное меню только с ползунком и текущим процентом громкости — ничего лишнего.',
        '• Документы приватности: в настройки добавлена полная официальная Политика конфиденциальности и Условия использования.'
      ].join('\n\n'),
      en: [
        'In this update we improved the built-in update installer and refined the voice call interface.',
        '• Seamless 1-click updates: fixed the update downloader inside the app. Updates now download smoothly and install without interruptions.',
        '• Streamlined user volume slider: right-clicking any participant in calls now brings up a clean, compact popover with just the volume slider and percentage.',
        '• Official legal documents: updated Privacy Policy and Terms of Service are now available in settings.'
      ].join('\n\n'),
      uk: [
        'У цьому оновленні ми покращили механізм оновлень та вдосконалили інтерфейс дзвінків.',
        '• Швидке автооновлення в 1 клік: усунуто помилку при завантаженні нових версій. Тепер клієнт оновлюється стабільно та безперебійно.',
        '• Спрощене налаштування гучності: за правим кліком на співрозмовника відкривається компактне віконце лише з повзунком та відсотком гучності.',
        '• Офіційні документи: додано повну Політику конфіденційності та Умови використання в налаштування.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.11',
    version: '0.5.11',
    date: '2026-09-28',
    title: {
      ru: 'Адаптивное масштабирование текста и окон',
      en: 'Adaptive Text & Window Scaling',
      uk: 'Адаптивне масштабування тексту та вікон'
    },
    summary: {
      ru: 'Плавное масштабирование текста и интерфейса под любой размер окон и мониторов.',
      en: 'Dynamic font and interface scaling based on window dimensions and screen sizes.',
      uk: 'Динамічне масштабування тексту та інтерфейсу під будь-який розмір вікон і моніторів.'
    },
    body: {
      ru: [
        'Интерфейс приложений NotOS теперь автоматически подстраивается под размеры окон и разрешение вашего экрана.',
        '• Адаптивный размер шрифтов: при изменении размера окон мессенджера, ИИ-чата и других окон размер шрифта сообщений, полей ввода, списков и заголовков плавно адаптируется. На больших экранах текст становится крупнее и читается комфортнее, а в небольших окнах аккуратно умещается без наложений.',
        '• Честные 100% высоты: окна полностью заполняют рабочее пространство без сжатия и пустых зон.'
      ].join('\n\n'),
      en: [
        'NotOS app interface now dynamically adapts to window dimensions and your monitor resolution.',
        '• Adaptive font sizes: message text, composers, sidebars, and titles automatically scale when you resize windows. Content stays clear and legible on wide displays and compact windows alike.',
        '• Perfect window proportions: windows fill the entire allocated space without awkward gaps or shrinking.'
      ].join('\n\n'),
      uk: [
        'Інтерфейс додатків NotOS тепер автоматично підлаштовується під розміри вікон та роздільну здатність екрана.',
        '• Адаптивний розмір шрифтів: під час зміни розміру вікон месенджера чи чату шрифти плавно масштабуються для зручного читання.',
        '• Точні пропорції: вікна коректно заповнюють робочий простір.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.10',
    version: '0.5.10',
    date: '2026-09-28',
    title: {
      ru: 'Персональная громкость и свободные окна',
      en: 'Per-User Volume & Window Freedom',
      uk: 'Персональна гучність та вільні вікна'
    },
    summary: {
      ru: 'Регулировка громкости собеседников по ПКМ, свободное перетаскивание окон и умные иконки.',
      en: 'Per-participant volume sliders, free window dragging to the top edge, and smart icon placement.',
      uk: 'Регулювання гучності співрозмовників за ПКМ, вільне переміщення вікон та розумні іконки.'
    },
    body: {
      ru: [
        'Большое обновление голосового общения и рабочего стола NotOS.',
        '• Персональная громкость собеседников: если кто-то говорит слишком тихо или слишком громко, нажмите правой кнопкой мыши по карточке участника в звонке или голосовом канале и настройте уровень от 0% до 200%. Настройка сохраняется персонально.',
        '• Свободное перемещение окон: окна на рабочем столе теперь можно подтягивать к самому верхнему краю экрана без принудительных отступов.',
        '• Защита от наложения иконок: ярлыки на рабочем столе автоматически находят свободное соседнее место при перетаскивании.'
      ].join('\n\n'),
      en: [
        'A major update for voice chat and the virtual desktop experience.',
        '• Individual volume control: adjust participant volume from 0% to 200% by right-clicking their card in voice calls or group rooms. Settings persist automatically.',
        '• Free window placement: move windows all the way to the top desktop edge without forced margin limits.',
        '• Desktop icon collision guard: icons automatically avoid overlapping when repositioned.'
      ].join('\n\n'),
      uk: [
        'Велике оновлення голосового зв’язку та робочого столу NotOS.',
        '• Персональна гучність співрозмовників: регулюйте звук кожного учасника від 0% до 200% через меню правої кнопки миші.',
        '• Вільне переміщення вікон: підтягуйте вікна до самого верхнього краю екрана.',
        '• Захист від накладання іконок: ярлики знаходять вільне місце на робочому столі.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.9',
    version: '0.5.9',
    date: '2026-09-28',
    title: {
      ru: 'Умный ИИ-помощник и плавающий звонок',
      en: 'Smart AI Assistant & Floating Call Bar',
      uk: 'Розумний AI-помічник та плаваючий дзвінок'
    },
    summary: {
      ru: 'Персоналии для ИИ, цитирование ответов, мини-панель активного звонка и галерея медиа.',
      en: 'AI personas, contextual quote replies, floating call mini-bar, and profile media tiles.',
      uk: 'Персони для AI, цитування відповідей, міні-панель дзвінка та галерея медіа.'
    },
    body: {
      ru: [
        '• Персоналии и контекст ИИ: нейросеть теперь помнит владельца, может общаться в разных ролях (эксперт, переводчик, собеседник), а также поддерживает ответы и цитаты в чате.',
        '• Плавающий виджет звонка: при сворачивании мессенджера или переходе в другие окна звонок остаётся под рукой в компактной панели с быстрым управлением звуком.',
        '• Плиточная галерея в профиле: вложения и фото теперь удобно расположены плитками.'
      ].join('\n\n'),
      en: [
        '• Contextual AI & personas: choose custom roles and personality for the AI assistant with quote replies.',
        '• Floating call bar: active call remains accessible in a compact widget when switching windows.',
        '• Media grid: photos and media in profiles are organized in a clean grid layout.'
      ].join('\n\n'),
      uk: [
        '• Персони та контекст AI: нейромережа пам’ятає власника та підтримує відповіді з цитатами.',
        '• Плаваючий віджет дзвінка: компактна панель залишається доступною при роботі з іншими вікнами.',
        '• Плиткова галерея: зручне розташування медіа у профілях.'
      ].join('\n\n')
    }
  },
  {
    id: 'update-0.5.8',
    version: '0.5.8',
    date: '2026-09-27',
    title: {
      ru: 'Watch Together и видео-сообщения',
      en: 'Watch Together & Video Circles',
      uk: 'Watch Together та відео-повідомлення'
    },
    summary: {
      ru: 'Синхронный просмотр видео с друзьями, видео-кружочки и стена профиля.',
      en: 'Synchronized cinema parties, Telegram-style video circles, and desktop walls.',
      uk: 'Синхронний перегляд відео, відео-кружечки та стіна профілю.'
    },
    body: {
      ru: [
        '• Watch Together: синхронный просмотр видео и фильмов вместе с друзьями с покадровой синхронизацией воспроизведения и паузы.',
        '• Видео-кружочки: запись и отправка мгновенных круглых видеосообщений в личных чатах и каналах.',
        '• Персональная стена: оставляйте друзьям памятные карточки, треки и стикеры прямо на их рабочем столе.'
      ].join('\n\n'),
      en: [
        '• Watch Together: watch movies and YouTube synchronously with friends in real-time rooms.',
        '• Video circles: record and share round video notes instantly in direct messages and channels.',
        '• Profile wall: leave notes, music tracks, and stickers on your friends\' virtual desktops.'
      ].join('\n\n'),
      uk: [
        '• Watch Together: спільний перегляд відео та фільмів із покадровою синхронізацією.',
        '• Відео-кружечки: запис та надсилання круглих відеоповідомлень.',
        '• Стіна профілю: залишайте друзям картки, треки та стікери на їхньому робочому столі.'
      ].join('\n\n')
    }
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
