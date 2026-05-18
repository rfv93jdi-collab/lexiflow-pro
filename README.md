# LexiFlow Pro

Веб-платформа юридического комплаенса для малого бизнеса и корпораций: диагностический квест, загрузка и аудит регламентов (PDF и изображения), сравнение документов, матрица рисков, интеграция с LLM (LLMost), чат-ассистент «Лекси», синхронизация с Firebase (пользователь, риски, задачи, регламенты, журнал активности).

## Возможности

- **Сегменты:** малый бизнес и корпорация (расширенный опросник и дополнительная матрица после сравнения документов).
- **Папки регламентов:** кадры, инфобез, судебный блок, налоги, закупки, реклама, конфиденциальность; загрузка до 10 документов на папку; саммари аудита и риски по папке.
- **Анализ:** извлечение текста из PDF (`pdfjs`), запросы к модели через прокси на сервере (ключ не попадает в клиентский бандл).
- **Firebase Auth + Firestore:** данные пользователя, риски, задачи, коллекция `regulations`.

## Стек

| Слой | Технологии |
|------|------------|
| UI | React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion, Recharts, Sonner |
| Сервер разработки и прод | Express + `tsx`, прокси `/api/llmost/*` → LLMost |
| Данные | Firebase 12 |
| AI | [LLMost](https://llmost.ru/docs) (OpenAI-совместимый API) |

## Требования

- Node.js **20+** (рекомендуется 22)
- npm
- Учётная запись Firebase (проект с Authentication и Firestore)
- Ключ **LLMost** или запасной Bearer в переменных окружения (см. ниже)

## Быстрый старт (локально)

1. Клонировать репозиторий и установить зависимости:

   ```bash
   git clone https://github.com/<ваш-логин>/<имя-репо>.git
   cd <имя-репо>
   npm install
   ```

2. Скопировать пример переменных и заполнить секреты:

   ```bash
   cp .env.example .env.local
   ```

   В **`.env.local`** задайте как минимум:

   - `LLMOST_API_KEY` — ключ API LLMost (читает только `server.ts`);
   - при необходимости `LLMOST_BASE_URL`, `LLMOST_MODEL`;
   - параметры Firebase (если они задаются через env в вашей сборке — проверьте `src` на `import.meta.env` / конфиг).

3. Запуск в режиме разработки (Vite middleware + API на одном порту):

   ```bash
   npm run dev
   ```

   По умолчанию: **http://localhost:3000** (см. `PORT` в `server.ts`).

4. Проверка типов:

   ```bash
   npm run lint
   ```

## Сборка под продакшен

```bash
npm run build
```

Статика появится в каталоге `dist/`. Поднять только фронт недостаточно: в браузере запросы идут на **`/api/llmost/chat/completions`**, поэтому нужен **Node-процесс** с `NODE_ENV=production`:

```bash
NODE_ENV=production npm run build
NODE_ENV=production npx tsx server.ts
```

Убедитесь, что на сервере доступен тот же `.env.local` (или переменные окружения хостинга) с `LLMOST_API_KEY`.

### Опционально: подкаталог (GitHub Pages и т.п.)

Если приложение отдаётся не с корня домена, задайте базовый путь при сборке:

```bash
VITE_BASE_URL=/имя-репозитория/ npm run build
```

На чистом GitHub Pages без бэкенда **прокси LLMost работать не будет** — нужен хостинг с Node или отдельный API. Для демо статики имеет смысл подключать внешний бэкенд или хостить полный `server.ts`.

## Структура репозитория

| Путь | Назначение |
|------|------------|
| `src/App.tsx` | Основной UI, Firebase, квест, аудит, матрица |
| `src/constants.ts` | Вопросы квеста, категории документов |
| `src/services/` | AI, LLM-клиент, Лекси |
| `src/lib/pdfText.ts` | Извлечение текста из PDF |
| `server.ts` | Express, Vite в dev, статика в prod, прокси LLMost |
| `.env.example` | Шаблон переменных окружения |

## Публикация кода на GitHub

1. Создайте пустой репозиторий на GitHub (например `Petrovskaia_VKR`).
2. В корне проекта задайте **своё** имя и email для коммитов (один раз):

   ```bash
   git config user.name "Ваше Имя"
   git config user.email "your@email.com"
   ```

3. Привяжите remote и отправьте ветку (подставьте свой URL):

   ```bash
   git remote remove origin 2>/dev/null
   git remote add origin https://github.com/<ваш-логин>/<имя-репо>.git
   git branch -M main
   git push -u origin main
   ```

   Если появляется ошибка **403 Permission denied**, войдите в нужный аккаунт GitHub: [Personal Access Token](https://github.com/settings/tokens) с правами `repo`, либо используйте SSH (`git@github.com:...`) и `ssh-add` ключа.

4. Для приватных ключей и `.env.local` используйте **Secrets** в CI или переменные окружения на PaaS, не коммитьте секреты.

## CI (GitHub Actions)

Готовый пример лежит в репозитории: [`docs/github-actions-ci.yml`](docs/github-actions-ci.yml). Для push из окружений с GitHub OAuth без scope **`workflow`** загрузка `.github/workflows/*` может быть запрещена — в таком случае добавьте workflow вручную в веб-интерфейсе GitHub или используйте Personal Access Token с правом **workflow**.

## Лицензия

Код считается предоставленным «как есть» для учебных целей.

## Контакты и документация ВКР

Проект выполняется в рамках выпускной квалификационной работы
