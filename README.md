# OFFSCRIPT — editorial journal, publishing studio, and offline-ready PWA

OFFSCRIPT is a bespoke, light-theme editorial magazine for culture, spaces, food, personal style, travel, and creative practice. It includes 17 starter stories, real Unsplash photography with local SVG fallbacks, Markdown publishing, an admin studio, bookmarks, search, a newsletter list, an RSS feed, sitemap, and a Progressive Web App service worker.

## Run locally

**Recommended runtime:** Node.js 24.22.1 (Active LTS as of 25 October 2026). Node is the only runtime requirement; the app uses built-in Node modules and does not require a framework build step.

1. Extract the ZIP.
2. Copy `.env.example` to `.env` and set your own `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` for the environment you are using. Keep `.env` private.
3. Run `npm start` (or `node server.js`).
4. Open `http://localhost:3000` and `http://localhost:3000/admin.html`.

The local development fallback is `editor` / `ChangeMe123!` **only when no `.env` is present**. Never expose that fallback to the public internet. Production startup rejects default/weak credentials and weak session secrets.

## Publish a story

Open the Studio, sign in, and create or edit a story. You can paste Markdown or import a `.md` file. The live preview and public reader support headings, paragraphs, bold, italics, ordered and unordered lists, blockquotes, inline code, secure external links, and horizontal rules. Choose a real photo from the preset list or use the bundled SVG covers. Public pages render Markdown as formatted content; HTML pasted into the Markdown field is escaped.

## Real photography and offline behaviour

- Starter article covers use curated URLs from the Unsplash image CDN. The site uses responsive image widths, lazy loading for story cards, descriptive alt text, and a local SVG fallback if a CDN image fails.
- The service worker caches the public shell, public article data, and viewed Unsplash/ Pexels images where the browser permits it. Offline imagery is best after the first online visit and while the browser retains its cache.
- Local SVG cover presets always remain available. The app itself, server, articles and subscriber list can run locally without internet after Node is installed. Real remote photos need an initial internet connection.
- Reader bookmarks are stored in the reader's browser.
- Newsletter submissions are saved to the app's content store and can be exported as CSV from the Studio. **No email is sent automatically**; sending campaigns needs a separate email provider and verified sender address.

See `PHOTO-CREDITS.md` for the photo set and licensing references, and `TECH-DECISIONS.md` for the dated stack research and hosting choices.

## Deploy online with persistent content

### Recommended: Render Blueprint

The included `render.yaml` creates a Node.js web service in Singapore with a persistent 1 GB volume mounted at `/var/data`. That directory holds articles and newsletter subscriptions across restarts/deploys. The blueprint prompts you to provide the three required secrets rather than committing credentials.

1. Put this project in a private or public GitHub repository (do not commit `.env`, real subscriber data, or custom secrets).
2. In Render, create a new Blueprint and select that repository. Render reads `render.yaml`.
3. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD` (unique and at least 12 characters), and `SESSION_SECRET` (a random string of at least 32 characters) when prompted.
4. Deploy, then visit the Render URL. The health check is `/api/health`; the Studio is `/admin.html`.
5. If you use a custom domain, set `SITE_URL` to the public `https://` origin in Render's environment settings so sitemap and RSS links use the canonical domain.

**Hosting note:** Render's persistent disks are available on paid services, not its ephemeral free filesystem. Do not deploy this JSON-backed CMS to an ephemeral host and assume articles will persist. If you need a free static-only showcase, the current full-stack publishing features will not work as intended without a separate persistent database. See [Render persistent disk documentation](https://render.com/docs/disks).

### Docker / VPS option

```bash
docker build -t offscript .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e ADMIN_USERNAME='your-editor-name' \
  -e ADMIN_PASSWORD='a-unique-password-of-at-least-12-chars' \
  -e SESSION_SECRET='generate-a-random-secret-at-least-32-characters-long' \
  -e DATA_DIR=/data \
  -v offscript-data:/data \
  offscript
```

Use HTTPS at your public reverse proxy, back up the `/data` volume, and configure `SITE_URL` for your domain. Do not put secrets in a source file or Docker image.

## Included capabilities

- Custom responsive editorial layout with light theme, no Roboto or remote-font dependency
- 17 starter articles with real photography, local cover fallbacks, lazy loading and responsive CDN sizes
- Article reader with Markdown rendering, reading time, sharing, bookmarks, category filters and search
- Protected admin studio for draft/publish/edit/delete, featured-story selection, `.md` import and live Markdown preview
- Persistent Node.js API and JSON data store; configurable `DATA_DIR` supports a mounted storage volume
- Newsletter signup list with duplicate-email handling and CSV export
- Clean, individually indexable `/story/{slug}` URLs with story-specific Open Graph/Twitter cards and canonical links; `/feed.xml` RSS, `/sitemap.xml`, `/robots.txt`, and `/api/health`
- PWA service worker for public shell/article/photo caching, offline page, app manifest, and app icon
- Production security headers, secure production admin cookie, signed 4-hour HttpOnly/SameSite sessions, strict same-origin checks, bounded body parsing, sign-in/newsletter rate limits, approved image hosts, security headers, and a Redis write lease for Vercel mutations
- Dockerfile, Render Blueprint, Node version pin, GitHub Actions CI, and built-in integration smoke test
- No runtime package dependencies

## Test and developer commands

```bash
npm ci
npm run check
npm test
npm start
```

The integration smoke test starts an isolated local server and verifies the public article API, admin login, origin checks, newsletter signup, article publishing, RSS, sitemap, and health endpoint.

## Notes and limitations

- The starter content and imaginary bylines are demo editorial copy; replace them before a real publication.
- The JSON store is intended for one small server instance. For a larger publication or multiple server instances, migrate content to PostgreSQL or another managed database.
- Newsletter capture is implemented, but no marketing email is sent by this project on its own.
- Actual public deployment requires a hosting account, a repository connection, and your private secrets. No public URL is claimed until a host confirms a successful deploy.

## References

- See `TECH-DECISIONS.md` for the reviewed sources and why each choice was made.

## Deploy to Vercel

This repository includes a Vercel Functions adapter in `api/`, plus rewrites for story pages, RSS, the sitemap and `robots.txt`. The public magazine and its 17 starter stories render without an external database.

### Publish the repository

1. Import this repository in Vercel and keep the Root Directory at `.`. The included `vercel.json` selects `public/` as the static output and routes dynamic requests through Node.js functions.
2. In **Settings → Environment Variables**, set a non-default `ADMIN_USERNAME` (at least 5 characters), `ADMIN_PASSWORD` (at least 12 characters), and a random `SESSION_SECRET` (at least 32 characters). Do not use values from `.env.example` in production.
3. For durable article edits and newsletter sign-ups, add an **Upstash Redis** database through the Vercel Marketplace and make sure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are available to the project. Redeploy after connecting it. The app stores its content document at the Redis key `offscript:store:v1` (override with `OFFSCRIPT_REDIS_KEY`). Vercel content writes use a short Redis lease to serialize concurrent edits; sign-in and newsletter rate-limit counters also use Redis when it is configured.
4. Set `SITE_URL` to your final HTTPS domain if you use a custom domain. Redeploy after changing environment variables.

Without Redis, the magazine remains readable from its bundled starter content, but admin publishing and newsletter writes return a clear `503` rather than pretending ephemeral writes were saved. Vercel Functions have a read-only deployment filesystem, so `data/store.json` is intentionally not committed and cannot be used as persistent production storage.

Local use still works with Node.js 24+: copy `.env.example` to `.env`, configure the three admin/session values, and run `npm start`. Local content changes are saved under `data/store.json`; `data/seed.json` is the checked-in starter content.

