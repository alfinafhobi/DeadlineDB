# Deployment Guide

## Recommended Stack

- Backend hosting: Render or Railway
- Database: MongoDB Atlas
- Domain: optional custom domain on hosting provider

## Environment Variables

Use these values in your deployment dashboard:

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=true
JWT_SECRET=replace-with-a-long-random-secret
PROVIDER_TOKEN_ENCRYPTION_KEY=replace-with-a-different-long-random-secret
JWT_EXPIRES_IN=7d
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/deadlinedb
CORS_ORIGINS=https://your-app.onrender.com
BODY_LIMIT=300kb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=250
AUTH_RATE_LIMIT_MAX=20
DASHBOARD_CACHE_TTL_MS=5000
LOG_LEVEL=info
REMINDER_CRON=*/5 * * * *
REMINDER_SCHEDULER_ENABLED=true
REMINDER_SWEEP_BATCH_SIZE=200
SOURCE_SYNC_CRON=*/30 * * * *
SOURCE_SYNC_SCHEDULER_ENABLED=false
SOURCE_SYNC_BATCH_SIZE=25
EMAIL_FROM=notifications@yourdomain.com
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
APP_BASE_URL=https://your-app.onrender.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-app.onrender.com/api/integrations/oauth/google/callback
TELEGRAM_WEBHOOK_SECRET=
DEFAULT_TIMEZONE=Asia/Calcutta
DEMO_MODE=false
DEMO_PASSWORD=demo123
```

## MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster.
2. Create a database user with read/write permissions.
3. Add your hosting provider IP or `0.0.0.0/0` temporarily while testing.
4. Copy the connection string and place it in `MONGO_URI`.

## Render Deployment

1. Push the project to GitHub.
2. Create a new Web Service in Render.
3. Select the DeadlineDB repository.
4. Set:
   - Build command: `npm install`
   - Start command: `npm run start:prod`
5. Add the production environment variables.
6. Deploy.
7. After deployment, update `CORS_ORIGINS` to the final Render URL.

## Railway Deployment

1. Create a new project in Railway.
2. Connect the repository.
3. Add all environment variables from the list above.
4. Ensure the start command is `npm run start:prod`.
5. Deploy and verify `/api/health`.

## Production Verification

After deployment, check:

- `GET /api/health` returns success
- user signup/login works
- dashboard loads without console errors
- room creation and joining work
- calendar export downloads successfully
- cron reminders are running by reviewing logs

## Production Checklist

- Use a strong JWT secret
- Use Atlas instead of in-memory Mongo
- Restrict CORS to real frontend origins
- Enable SMTP only when credentials are ready
- Keep `REMINDER_CRON` at 5 minutes or slower in production
- Run `npm run check:syntax` before each release
- Review the remaining `npm audit` issue before final public deployment
