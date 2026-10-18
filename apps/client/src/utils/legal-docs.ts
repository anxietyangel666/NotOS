import type { Language } from '../api/types';

export type LegalSection = {
  title: string;
  content: string;
};

export type LegalDoc = {
  title: string;
  sections: LegalSection[];
};

export function getLegalDoc(type: 'privacy' | 'terms', language: Language): LegalDoc {
  return LEGAL_DOCS[type][language] || LEGAL_DOCS[type].ru || LEGAL_DOCS[type].en || { title: '', sections: [] };
}

export const LEGAL_DOCS: Record<'privacy' | 'terms', Partial<Record<Language, LegalDoc>>> = {
  privacy: {
    ru: {
      title: 'Политика конфиденциальности',
      sections: [
        {
          title: '1. Общие положения',
          content: 'Настоящая Политика конфиденциальности описывает, как сервис NotOS (далее — «Сервис») обрабатывает и защищает данные пользователей. Мы уважительно относимся к вашей приватности и сводим сбор информации к строго необходимому минимуму для обеспечения связи.'
        },
        {
          title: '2. Сбор и использование информации',
          content: 'NotOS собирает только базовые данные, необходимые для вашей авторизации и функционирования комнат: ваш никнейм, уникальный идентификатор сессии и выбранные вами пользовательские настройки. Все персональные файлы сессий и ключи авторизации генерируются и хранятся локально на вашем компьютере.'
        },
        {
          title: '3. Голосовые данные и медиапотоки',
          content: 'Голосовые и видеопотоки во время звонков и конференций передаются по зашифрованным WebRTC-каналам напрямую между участниками либо через защищенные медиа-шлюзы. Мы не ведем скрытую запись ваших разговоров и не сохраняем содержимое трансляций экранов.'
        },
        {
          title: '4. Передача третьим лицам',
          content: 'Мы принципиально не продаем, не передаем и не монетизируем пользовательские данные рекламным сетям или аналитическим трекерам.'
        },
        {
          title: '5. Обновления политики',
          content: 'Политика конфиденциальности может обновляться по мере добавления новых функций. Актуальная версия всегда доступна на официальном сайте notos.tech.'
        }
      ]
    },
    en: {
      title: 'Privacy Policy',
      sections: [
        {
          title: '1. Overview',
          content: 'This Privacy Policy explains how NotOS ("Service") collects, protects, and handles your information. We value your privacy and keep data collection strictly minimal.'
        },
        {
          title: '2. Data Collection',
          content: 'NotOS only processes basic session information necessary for authentication and voice room operation: chosen nickname, session identifiers, and user preferences. Authentication credentials and session files are stored locally on your machine.'
        },
        {
          title: '3. Voice & Media Streams',
          content: 'Voice and screen share media are transmitted via encrypted WebRTC connections directly between peers or via secure media gateways. We never record your voice calls or store screen share frames.'
        },
        {
          title: '4. Third-Party Sharing',
          content: 'We do not sell, rent, or monetize personal information with advertisers or tracking networks.'
        },
        {
          title: '5. Policy Updates',
          content: 'The privacy policy may be updated as new features are added. The current version is always available on notos.tech.'
        }
      ]
    },
    uk: {
      title: 'Політика конфіденційності',
      sections: [
        {
          title: '1. Загальні положення',
          content: 'Ця Політика конфіденційності регулює порядок обробки даних у NotOS. Ми поважаємо вашу приватність і зводимо збір даних до мінімуму.'
        },
        {
          title: '2. Дані та сесії',
          content: 'Зберігаються лише дані, необхідні для авторизації та роботи кімнат. Усі файли сесій генеруються і зберігаються локально на комп’ютері.'
        },
        {
          title: '3. Голос та трансляція',
          content: 'Медіапотоки передаються зашифрованими каналами WebRTC напряму. Ми не ведемо запис розмов та трансляцій екрана.'
        },
        {
          title: '4. Передача третім особам',
          content: 'Ми принципово не продаємо та не передаємо персональні дані рекламним мережам або трекерам.'
        },
        {
          title: '5. Оновлення політики',
          content: 'Політика може оновлюватися в міру додавання функцій. Актуальна версія завжди доступна на notos.tech.'
        }
      ]
    },
    zh: {
      title: '隐私政策',
      sections: [
        {
          title: '1. 概述',
          content: '本隐私政策说明NotOS如何保护您的隐私与数据。我们致力于最大程度减少数据收集。'
        },
        {
          title: '2. 数据收集',
          content: 'NotOS仅处理会话及语音通信所需的基本信息：昵称、会话标识符及个人偏好设置。认证文件仅保存在本地设备上。'
        },
        {
          title: '3. 语音与媒体流',
          content: '语音与屏幕共享流通过端到端加密的WebRTC传输。我们不会录制您的通话或储存屏幕共享内容。'
        },
        {
          title: '4. 第三方分享',
          content: '我们绝不出售、出租或与广告追踪网络共享您的任何个人数据。'
        },
        {
          title: '5. 政策更新',
          content: '隐私政策将随功能迭代保持更新，最新版本可在官方网站 notos.tech 查看。'
        }
      ]
    }
  },
  terms: {
    ru: {
      title: 'Условия использования',
      sections: [
        {
          title: '1. Принятие условий',
          content: 'Используя клиент или сервисы NotOS, вы соглашаетесь соблюдать настоящие Условия использования. Если вы не согласны с какими-либо положениями, пожалуйста, воздержитесь от использования Сервиса.'
        },
        {
          title: '2. Правила поведения',
          content: 'Пользователям запрещается использовать Сервис для распространения вредоносного программного обеспечения, организации спам-рассылок, нарушения законов, оскорблений и действий, нарушающих работу инфраструктуры Сервиса.'
        },
        {
          title: '3. Интеллектуальная собственность',
          content: 'Все права на графические материалы, код, бренд и логотип NotOS принадлежат разработчикам проекта. Вы получаете право использовать клиентское приложение исключительно в личных некоммерческих целях.'
        },
        {
          title: '4. Отказ от гарантий',
          content: 'Сервис предоставляется по принципу «как есть» (as is). Мы постоянно работаем над улучшением стабильности и безопасности, однако не несем ответственности за временные перебои со связью у третьих провайдеров.'
        }
      ]
    },
    en: {
      title: 'Terms of Service',
      sections: [
        {
          title: '1. Acceptance',
          content: 'By using NotOS applications or infrastructure, you agree to these Terms of Service. If you disagree with any part, please cease using the application.'
        },
        {
          title: '2. User Conduct',
          content: 'You agree not to use the Service for spamming, transmitting malicious payloads, violating applicable laws, or disrupting the network infrastructure.'
        },
        {
          title: '3. Intellectual Property',
          content: 'All brand assets, source code, logos, and designs of NotOS belong to the NotOS development team. You are granted a personal, non-commercial license to use the client.'
        },
        {
          title: '4. Disclaimer',
          content: 'The service is provided on an "as is" basis. We continuously work to improve stability and security, but are not liable for temporary service interruptions from third-party networks.'
        }
      ]
    },
    uk: {
      title: 'Умови використання',
      sections: [
        {
          title: '1. Прийняття умов',
          content: 'Користуючись NotOS, ви погоджуєтеся дотримуватися цих Умов використання. Якщо ви не згодні з будь-якими положеннями, будь ласка, припиніть використання Сервісу.'
        },
        {
          title: '2. Правила поведінки',
          content: 'Заборонено використовувати Сервіс для спаму, шкідливого ПЗ або порушення законодавства та стабільності мережі.'
        },
        {
          title: '3. Інтелектуальна власність',
          content: 'Усі права на матеріали, код, бренд та логотип NotOS належать розробникам. Клієнт надається для особистого некомерційного використання.'
        },
        {
          title: '4. Відмова від гарантій',
          content: 'Сервіс надається за принципом «як є» (as is). Ми постійно вдосконалюємо безпеку, але не несемо відповідальності за збої у сторонніх провайдерів.'
        }
      ]
    },
    zh: {
      title: '使用条款',
      sections: [
        {
          title: '1. 条款接受',
          content: '使用NotOS客户端或服务即表示您同意遵守本使用条款。如不同意其中任何条款，请停止使用本服务。'
        },
        {
          title: '2. 行为准则',
          content: '用户不得将本服务用于发送垃圾邮件、传播恶意程序、违反法律法规或破坏系统基础设施。'
        },
        {
          title: '3. 知识产权',
          content: 'NotOS的所有图形设计、代码、品牌及Logo均归开发团队所有。您享有个人非商业性质的使用授权。'
        },
        {
          title: '4. 免责声明',
          content: '本服务按“现状”（as is）提供。我们将不断提升稳定性和安全性，但不承担由第三方网络造成的不可抗力中断责任。'
        }
      ]
    }
  }
};
