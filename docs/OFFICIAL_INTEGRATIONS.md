# Official Provider Integrations

DeadlineDB supports only these direct integration providers:

- Google Classroom through the official Google Classroom API
- Gmail through the official Gmail API
- Telegram through the official Telegram Bot API

The app intentionally does not support Canvas, Moodle, scraping, unofficial chat readers, or private chat scraping.

## Google Classroom

Use the secure OAuth flow from the Integrations page. Required environment variables:

```env
APP_BASE_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/oauth/google/callback
PROVIDER_TOKEN_ENCRYPTION_KEY=
```

The adapter uses read-only Classroom scopes for courses and coursework. Imported coursework is normalized into personal assignments by default and retains source metadata such as course ID, coursework ID, alternate link, creation time, and raw provider metadata.

## Gmail

Use the secure OAuth flow from the Integrations page. Gmail sync reads messages using Gmail API filters such as:

```text
query=assignment OR deadline
senderFilters=faculty@college.edu
keywordFilters=submit,due,deadline
labelFilters=INBOX
```

When an academic message has clear task intent and a detected due date, DeadlineDB imports it as an assignment. If it has academic reminder intent but no due date, it imports as a reminder.

## Telegram

Telegram support uses the official Telegram Bot API. DeadlineDB can receive bot-visible private chat, approved group, and approved channel messages through webhook or polling flows.

Required environment variable for optional webhook hardening:

```env
TELEGRAM_WEBHOOK_SECRET=
```

Webhook URL:

```text
https://your-public-domain.com/api/integrations/webhooks/telegram
```

For group-wide message capture, add the bot to the group/channel and check BotFather privacy mode settings. If privacy mode is enabled, Telegram may only deliver commands, mentions, replies, and service messages to the bot.

## Sync Behavior

- Manual sync: `POST /api/integrations/:id/sync`
- OAuth start: `POST /api/integrations/oauth/:provider/start`
- OAuth callback: `GET /api/integrations/oauth/google/callback`
- Telegram webhook readiness: `GET /api/integrations/webhooks/telegram`
- Telegram inbound webhook: `POST /api/integrations/webhooks/telegram`

Duplicate prevention uses provider IDs plus a stable `syncHash` stored in `ImportedSourceItem`.
