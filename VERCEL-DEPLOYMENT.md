# Deploy OFFSCRIPT on Vercel

## 1. Prepare the repository

1. Put the contents of this project at the root of a GitHub repository. Keep `.env`, `data/store.json`, real subscriber exports, and all secrets out of Git.
2. Locally, run `npm run check` and `npm test` from the project root.
3. Push the tested commit to GitHub.

## 2. Import it into Vercel

1. Open [Vercel New Project](https://vercel.com/new) and import your repository.
2. Set **Framework Preset** to **Other** and **Root Directory** to `.`.
3. Keep the repository's `vercel.json` configuration. It sets `public/` as the static output directory, routes story/SEO endpoints through the Node.js functions, and configures browser security headers.
4. Use **Node.js 24.x** in Project → Settings → Build & Deployment → Node.js Version. The repository requires Node 24 or newer.
5. Deploy once to create the project URL; do not treat it as ready for publishing until the database and private variables below are configured.

## 3. Add private environment variables

In Project → Settings → Environment Variables, configure these for **Production and Preview**. Use distinct credentials for Preview when possible.

- `ADMIN_USERNAME`: a non-default name, at least 5 characters. Values such as `editor` or `admin` are rejected in production.
- `ADMIN_PASSWORD`: a unique password with at least 12 characters.
- `SESSION_SECRET`: a cryptographically random value with at least 32 characters.
- `SITE_URL`: the full HTTPS origin used publicly, e.g. `https://your-project.vercel.app`. Add your custom domain here once it is attached.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: added by the Redis integration in the next step.

Generate a secret locally with Node.js and paste it directly into Vercel; never commit it or share it in chat:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

After changing environment variables, create a new deployment; existing deployments do not inherit later changes automatically.

## 4. Connect durable publishing storage

Vercel's function filesystem is not a persistent CMS database. Add an Upstash Redis database using the [Vercel integration guide](https://upstash.com/docs/redis/howto/vercelintegration), then verify that `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` exist in the Vercel project's environment settings.

OFFSCRIPT uses `offscript:store:v1` as the default content key (change it with `OFFSCRIPT_REDIS_KEY` only before you have production content). The first request initializes the Redis value from `data/seed.json`. Subsequent article edits and newsletter sign-ups are written to Redis. Vercel writes are serialized with a short Redis lease to reduce concurrent overwrites. Sign-in and newsletter rate limits also use Redis when available.

**Do not skip Redis.** Without it, the public journal can render sample content, but Studio sign-in is disabled, article saves are unavailable, and newsletter submissions return `503` instead of claiming success. Check `/api/health`: `persistentStorage` must be `true` before publishing.

## 5. Verify the deployment

After redeploying with variables and Redis connected, check:

- `/` — homepage artwork, categories, story cards and mobile layout.
- `/admin.html` — login page; sign in with the private environment credentials.
- `/api/health` — `ok: true` and `persistentStorage: true`.
- `/api/articles` — published content returns as JSON.
- `/story/the-art-of-noticing` — story-specific metadata and canonical URL.
- `/feed.xml`, `/sitemap.xml`, `/robots.txt` — SEO endpoints.
- In the Studio, save a **draft**, refresh the page and confirm it remains; then publish it and check its public story URL.
- Submit a test newsletter address and confirm the count appears in the Studio. The app stores and exports addresses but **does not send email campaigns or confirmation emails**; add an email provider before promising delivery.

## 6. Domain and operating notes

Add a domain in Vercel → Project → Settings → Domains, complete the DNS records Vercel displays, then set `SITE_URL` to the final HTTPS origin and redeploy. Keep a secure backup plan for the Redis content key before major edits.

The admin is a single environment-configured editor account. This implementation does not yet include MFA, multiple roles, password recovery, confirmed newsletter opt-ins, or a transactional email provider. It has meaningful baseline hardening, but it should not be described as a formally audited or fully secure system until those operational gaps and a production security review are addressed.
