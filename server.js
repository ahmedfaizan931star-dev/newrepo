import { createServer } from 'node:http';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_VERCEL = process.env.VERCEL === '1';
// Small .env reader so this dependency-free app behaves as documented. Shell/host values win.
const envFile = path.join(__dirname, '.env');
if (!IS_VERCEL && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      let value = match[2];
      if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const SITE_URL = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production' || IS_VERCEL;
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'editor').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-development-only-change-before-deploying-please';
const REDIS_URL = String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim().replace(/\/+$/, '');
const REDIS_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
const REDIS_KEY = String(process.env.OFFSCRIPT_REDIS_KEY || 'offscript:store:v1').trim();
const hasPersistentRemoteStore = Boolean(REDIS_URL && REDIS_TOKEN);
const COOKIE_NAME = isProduction ? '__Host-offscript_admin' : 'offscript_admin';
const SESSION_TTL_SECONDS = 4 * 60 * 60;
const MAX_BODY = 40 * 1024;
const MAX_SUBSCRIBERS = 50000;
const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_WINDOW_MS = RATE_WINDOW_SECONDS * 1000;

const unsafePlaceholders = new Set([
  'ChangeMe123!', 'please-change-this-password', 'choose-a-unique-password-at-least-12-characters',
  'local-development-only-change-before-deploying-please', 'replace-this-with-a-long-random-secret-at-least-32-characters',
  'replace-with-a-long-random-secret-at-least-32-characters',
]);
if (isProduction && (SESSION_SECRET.length < 32 || ADMIN_PASSWORD.length < 12 || unsafePlaceholders.has(SESSION_SECRET) || unsafePlaceholders.has(ADMIN_PASSWORD))) {
  throw new Error('Set a unique 32+ character SESSION_SECRET and a unique ADMIN_PASSWORD of at least 12 characters before production.');
}
if (isProduction && (ADMIN_USERNAME.trim().length < 5 || ['editor', 'admin', 'administrator', 'username', 'test'].includes(ADMIN_USERNAME.trim().toLowerCase()))) {
  throw new Error('Set a non-default ADMIN_USERNAME of at least 5 characters before production.');
}
if (!IS_VERCEL) mkdirSync(DATA_DIR, { recursive: true });

function readSeedStore() {
  try {
    const value = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
    if (!Array.isArray(value.articles) || !Array.isArray(value.subscribers)) throw new Error('Seed store is missing articles or subscribers.');
    return value;
  } catch (error) {
    throw new Error(`Unable to load seed content at ${SEED_PATH}: ${error.message}`);
  }
}
const seedStore = readSeedStore();
let store;
if (IS_VERCEL) {
  // Vercel's deployment filesystem is read-only; persistent edits are stored in Redis.
  store = JSON.parse(JSON.stringify(seedStore));
} else {
  if (!existsSync(STORE_PATH)) writeFileSync(STORE_PATH, JSON.stringify(seedStore, null, 2));
  try { store = JSON.parse(readFileSync(STORE_PATH, 'utf8')); }
  catch { throw new Error(`The content store at ${STORE_PATH} is not valid JSON. Restore a backup or remove the file to re-seed demo data.`); }
  if (!Array.isArray(store.articles) || !Array.isArray(store.subscribers)) throw new Error('The content store is missing articles or subscribers.');
}
async function redisCommand(command) {
  if (!hasPersistentRemoteStore) throw Object.assign(new Error('Persistent storage is not connected. In Vercel, add an Upstash Redis integration and set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, then redeploy.'), { status: 503 });
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw Object.assign(new Error('The connected Redis database could not complete the request.'), { status: 503 });
  return payload.result;
}
async function loadStore() {
  if (!IS_VERCEL) return;
  if (!hasPersistentRemoteStore) {
    // The public website remains readable from the bundled seed; writes are refused below.
    store = JSON.parse(JSON.stringify(seedStore));
    return;
  }
  let value = await redisCommand(['GET', REDIS_KEY]);
  if (value == null) {
    value = JSON.stringify(seedStore);
    await redisCommand(['SET', REDIS_KEY, value]);
  }
  try { store = JSON.parse(value); }
  catch { throw Object.assign(new Error('Stored OFFSCRIPT content is invalid. Restore the Redis value for OFFSCRIPT or clear it to re-seed the demo stories.'), { status: 503 }); }
  if (!Array.isArray(store.articles) || !Array.isArray(store.subscribers)) throw Object.assign(new Error('Stored OFFSCRIPT content is missing required fields.'), { status: 503 });
}
async function persist(nextStore = store) {
  // Persist the candidate first. If storage fails, the in-memory view stays unchanged.
  const serialized = JSON.stringify(nextStore);
  if (IS_VERCEL) {
    await redisCommand(['SET', REDIS_KEY, serialized]);
    store = nextStore;
    return;
  }
  const temp = `${STORE_PATH}.tmp`;
  writeFileSync(temp, JSON.stringify(nextStore, null, 2));
  renameSync(temp, STORE_PATH);
  store = nextStore;
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const loginAttempts = new Map();
const newsletterAttempts = new Map();
const nowIso = () => new Date().toISOString();
const clone = (object) => JSON.parse(JSON.stringify(object));
const sha = (value) => createHash('sha256').update(String(value)).digest();
function safeEqual(a, b) { return timingSafeEqual(sha(a), sha(b)); }
function sign(value) { return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function createSession() { const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_SECONDS * 1000, nonce: randomBytes(16).toString('base64url') })).toString('base64url'); return `${payload}.${sign(payload)}`; }
function validSession(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return [part, ''];
    try { return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; } catch { return [part.slice(0, index), '']; }
  }));
}
function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}
function sendText(res, status, value) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(value); }
async function readBody(req) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!total) return {};
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    throw Object.assign(new Error('Use Content-Type: application/json for this endpoint.'), { status: 415 });
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required');
    return parsed;
  } catch { throw Object.assign(new Error('Send a valid JSON object.'), { status: 400 }); }
}
function clientAddress(req) {
  // On Vercel, x-forwarded-for is extended by the trusted edge; use the last hop rather than
  // accepting a client-controlled first entry. Locally, use Node's socket address.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  return String(forwarded.at(-1) || req.socket.remoteAddress || 'unknown').slice(0, 100);
}
function pruneRateMap(map) {
  if (map.size < 1000) return;
  const now = Date.now();
  for (const [key, entry] of map) if (entry.resetAt <= now) map.delete(key);
  while (map.size > 5000) map.delete(map.keys().next().value);
}
async function rateLimitExceeded(req, bucket, limit, map) {
  const addressKey = createHash('sha256').update(clientAddress(req)).digest('hex');
  if (IS_VERCEL && hasPersistentRemoteStore) {
    const key = `${REDIS_KEY}:security:${bucket}:${addressKey}`;
    const count = Number(await redisCommand(['INCR', key]));
    if (count === 1) await redisCommand(['EXPIRE', key, RATE_WINDOW_SECONDS]);
    return count > limit;
  }
  pruneRateMap(map);
  const key = `${bucket}:${addressKey}`;
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
  entry.count += 1;
  map.set(key, entry);
  return entry.count > limit;
}
async function clearRateLimit(req, bucket, map) {
  const addressKey = createHash('sha256').update(clientAddress(req)).digest('hex');
  if (IS_VERCEL && hasPersistentRemoteStore) {
    await redisCommand(['DEL', `${REDIS_KEY}:security:${bucket}:${addressKey}`]);
    return;
  }
  map.delete(`${bucket}:${addressKey}`);
}
async function acquireStoreLock() {
  const key = `${REDIS_KEY}:write-lock`;
  const token = randomBytes(24).toString('hex');
  // A short renewable-by-retry lease prevents concurrent Vercel function mutations from
  // overwriting each other's whole-document JSON updates.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await redisCommand(['SET', key, token, 'NX', 'PX', 12000]);
    if (result === 'OK') {
      return async () => {
        try {
          await redisCommand(['EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token]);
        } catch (error) { console.error('Store lock release failed; its lease will expire automatically.', error); }
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw Object.assign(new Error('The publishing store is busy. Please retry in a moment.'), { status: 503 });
}
function isStoreMutation(method, pathname) {
  return (method === 'POST' && pathname === '/api/newsletter') ||
    (['POST', 'PUT', 'DELETE'].includes(method) && (pathname === '/api/admin/articles' || /^\/api\/admin\/articles\/\d+$/.test(pathname)));
}
function requireAdmin(req, res) { const token = parseCookies(req.headers.cookie)[COOKIE_NAME]; if (validSession(token)) return true; json(res, 401, { error: 'Please sign in to the publishing studio.' }); return false; }
function publicArticle(article) { const { id, slug, title, excerpt, category, author, read_time, image, body, featured, published, created_at, updated_at } = article; return { id, slug, title, excerpt, category, author, read_time, image, body, featured: Boolean(featured), published: Boolean(published), created_at, updated_at }; }
function xmlEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}
function resolveSiteUrl(req) {
  if (SITE_URL) return SITE_URL;
  if (IS_VERCEL) {
    const platformHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').trim();
    if (platformHost && /^[a-z0-9.-]+(?::\d+)?$/i.test(platformHost)) return `https://${platformHost}`;
  }
  const host = String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, '');
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = isProduction ? 'https' : (forwarded === 'https' ? 'https' : 'http');
  return `${protocol}://${host}`;
}
function buildSitemap(req) {
  const origin = resolveSiteUrl(req);
  const articles = store.articles.filter((article) => article.published);
  const entries = [`<url><loc>${xmlEscape(origin)}/</loc></url>`, `<url><loc>${xmlEscape(origin)}/feed.xml</loc></url>`, ...articles.map((article) => {
    const loc = `${origin}/story/${encodeURIComponent(article.slug)}`;
    return `<url><loc>${xmlEscape(loc)}</loc><lastmod>${xmlEscape((article.updated_at || article.created_at || nowIso()).slice(0, 10))}</lastmod></url>`;
  })];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`;
}
function buildFeed(req) {
  const origin = resolveSiteUrl(req);
  const items = store.articles.filter((article) => article.published)
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
    .slice(0, 30).map((article) => {
      const link = `${origin}/story/${encodeURIComponent(article.slug)}`;
      return `<item><title>${xmlEscape(article.title)}</title><link>${xmlEscape(link)}</link><guid isPermaLink="true">${xmlEscape(link)}</guid><description>${xmlEscape(article.excerpt)}</description><category>${xmlEscape(article.category)}</category><dc:creator>${xmlEscape(article.author)}</dc:creator><pubDate>${new Date(article.updated_at || article.created_at || Date.now()).toUTCString()}</pubDate></item>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>OFFSCRIPT — A journal for curious living</title><link>${xmlEscape(origin)}/</link><description>An independent journal for the beautifully unfinished.</description><language>en</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items.join('')}</channel></rss>`;
}
function htmlEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function renderStoryPage(req, slug) {
  const article = store.articles.find((item) => item.published && item.slug === slug);
  if (!article) return null;
  const origin = resolveSiteUrl(req);
  const canonical = `${origin}/story/${encodeURIComponent(article.slug)}`;
  const image = /^https:\/\//i.test(article.image) ? article.image : `${origin}${article.image}`;
  const title = `${article.title} — OFFSCRIPT`;
  const description = article.excerpt || 'An independent journal for curious living.';
  return readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${htmlEscape(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/i, `<meta name="description" content="${htmlEscape(description)}">`)
    .replace(/<meta property="og:type" content="[^"]*">/i, '<meta property="og:type" content="article">')
    .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${htmlEscape(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${htmlEscape(description)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${htmlEscape(canonical)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${htmlEscape(image)}">`)
    .replace(/<meta property="og:image:alt" content="[^"]*">/i, `<meta property="og:image:alt" content="${htmlEscape(article.title)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/i, `<meta name="twitter:title" content="${htmlEscape(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/i, `<meta name="twitter:description" content="${htmlEscape(description)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${htmlEscape(image)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${htmlEscape(canonical)}">`);
}

function normalizeArticle(input) {
  const title = String(input.title || '').trim().slice(0, 140);
  const excerpt = String(input.excerpt || '').trim().slice(0, 320);
  const category = String(input.category || '').trim().slice(0, 50);
  const author = String(input.author || 'Offscript Editors').trim().slice(0, 80);
  const image = String(input.image || '').trim().slice(0, 1000);
  const body = String(input.body || '').trim().slice(0, 30000);
  const categories = new Set(['Culture', 'Spaces', 'At the Table', 'Style', 'Elsewhere', 'Practice', 'People', 'Ideas', 'Plants', 'Beauty']);
  const read_time = Math.round(Math.min(60, Math.max(1, Number(input.read_time) || 5)));
  if (!title || !excerpt || !category || !image || !body) throw Object.assign(new Error('Title, excerpt, category, image and story text are required.'), { status: 400 });
  if (!categories.has(category)) throw Object.assign(new Error('Choose a supported journal department.'), { status: 400 });
  const localImage = /^\/images\/[a-z0-9._/-]+\.(svg|png|jpe?g|webp)$/i.test(image) && !image.includes('..');
  let remoteImage;
  try { remoteImage = new URL(image); } catch {}
  const approvedRemoteImage = remoteImage?.protocol === 'https:' && ['images.unsplash.com', 'images.pexels.com'].includes(remoteImage.hostname.toLowerCase());
  if (!localImage && !approvedRemoteImage) throw Object.assign(new Error('Choose a bundled /images/ cover or a photo hosted by images.unsplash.com or images.pexels.com.'), { status: 400 });
  const baseSlug = String(input.slug || title).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || `story-${Date.now()}`;
  return { slug: baseSlug, title, excerpt, category, author, image, body, read_time, featured: Boolean(input.featured), published: Boolean(input.published) };
}
function ensureSameOrigin(req, res) {
  const origin = req.headers.origin;
  // Browser mutations should carry Origin; don't silently accept an origin-less request in production.
  if (!origin) {
    if (!isProduction && req.headers['sec-fetch-site'] !== 'cross-site') return true;
    json(res, 403, { error: 'A same-origin request is required.' });
    return false;
  }
  try {
    const parsed = new URL(origin);
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase()) return true;
  } catch {}
  json(res, 403, { error: 'This request did not come from this site.' });
  return false;
}
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' https://images.unsplash.com https://images.pexels.com data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method || 'GET';
  if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, service: 'offscript-api', persistentStorage: !IS_VERCEL || hasPersistentRemoteStore, timestamp: nowIso() });
  if (method === 'GET' && pathname === '/api/articles') {
    const category = (searchParams.get('category') || '').trim(); const search = (searchParams.get('search') || '').trim().slice(0, 100).toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 30));
    const articles = store.articles.filter((article) => article.published && (!category || category === 'All' || article.category === category) && (!search || `${article.title} ${article.excerpt} ${article.category} ${article.author}`.toLowerCase().includes(search))).sort((a, b) => Number(b.featured) - Number(a.featured) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit).map(publicArticle);
    return json(res, 200, { articles }, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
  }
  if (method === 'GET' && pathname.startsWith('/api/articles/')) {
    const slug = decodeURIComponent(pathname.slice('/api/articles/'.length)); const article = store.articles.find((item) => item.published && item.slug === slug);
    return article ? json(res, 200, { article: publicArticle(article) }, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }) : json(res, 404, { error: 'Story not found.' });
  }
  if (method === 'POST' && pathname === '/api/newsletter') {
    if (IS_VERCEL && !hasPersistentRemoteStore) return json(res, 503, { error: 'Newsletter storage is not connected. Add Upstash Redis before accepting sign-ups.' });
    if (!ensureSameOrigin(req, res)) return;
    if (await rateLimitExceeded(req, 'newsletter', 5, newsletterAttempts)) return json(res, 429, { error: 'Too many sign-up attempts. Please try again later.' });
    const body = await readBody(req);
    // Honeypot field for basic bot filtering. Respond normally but never store the fake submission.
    if (String(body.company || '').trim()) return json(res, 201, { message: 'You’re on the list. Look out for the next letter.' });
    const email = String(body.email || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    if (store.subscribers.some((subscriber) => subscriber.email.toLowerCase() === email)) return json(res, 200, { message: 'You’re already on the list. We’ll be in touch.' });
    if (store.subscribers.length >= MAX_SUBSCRIBERS) return json(res, 503, { error: 'The reader list is at capacity. Please contact the journal team.' });
    const nextStore = clone(store);
    nextStore.subscribers.push({ email, created_at: nowIso() });
    await persist(nextStore);
    return json(res, 201, { message: 'You’re on the list. Look out for the next letter.' });
  }
  if (method === 'POST' && pathname === '/api/admin/login') {
    if (IS_VERCEL && !hasPersistentRemoteStore) return json(res, 503, { error: 'Publishing storage is not connected. Add Upstash Redis before enabling Studio sign-in.' });
    if (!ensureSameOrigin(req, res)) return;
    if (await rateLimitExceeded(req, 'login', 8, loginAttempts)) return json(res, 429, { error: 'Too many attempts. Try again in ten minutes.' });
    const body = await readBody(req);
    if (!safeEqual(String(body.username || ''), ADMIN_USERNAME) || !safeEqual(String(body.password || ''), ADMIN_PASSWORD)) return json(res, 401, { error: 'That sign-in did not match.' });
    await clearRateLimit(req, 'login', loginAttempts);
    const cookie = `${COOKIE_NAME}=${encodeURIComponent(createSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${isProduction ? '; Secure' : ''}`;
    return json(res, 200, { message: 'Welcome to the studio.' }, { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
  }
  if (pathname.startsWith('/api/admin/')) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !ensureSameOrigin(req, res)) return;
    if (method === 'POST' && pathname === '/api/admin/logout') return json(res, 200, { message: 'Signed out.' }, { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}` });
    if (!requireAdmin(req, res)) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && IS_VERCEL && !hasPersistentRemoteStore) return json(res, 503, { error: 'Publishing storage is not connected. Add Upstash Redis before saving changes.' });
    if (method === 'GET' && pathname === '/api/admin/me') return json(res, 200, { username: ADMIN_USERNAME });
    if (method === 'GET' && pathname === '/api/admin/stats') return json(res, 200, { articles: store.articles.length, published: store.articles.filter((a) => a.published).length, drafts: store.articles.filter((a) => !a.published).length, subscribers: store.subscribers.length });
    if (method === 'GET' && pathname === '/api/admin/articles') return json(res, 200, { articles: clone(store.articles).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map(publicArticle) });
    if (method === 'GET' && pathname === '/api/admin/subscribers') return json(res, 200, { subscribers: store.subscribers.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)) });
    if (method === 'POST' && pathname === '/api/admin/articles') {
      const body = await readBody(req); const item = normalizeArticle(body);
      if (store.articles.some((a) => a.slug === item.slug)) return json(res, 409, { error: 'A story with that slug already exists. Change its title or slug.' });
      const nextStore = clone(store);
      if (item.featured) nextStore.articles.forEach((a) => { a.featured = false; });
      const article = { id: nextStore.nextId++, ...item, created_at: nowIso(), updated_at: nowIso() };
      nextStore.articles.push(article);
      await persist(nextStore);
      return json(res, 201, { article: publicArticle(article) });
    }
    const match = pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
    if (match && method === 'PUT') {
      const body = await readBody(req); const item = normalizeArticle(body); const id = Number(match[1]); const index = store.articles.findIndex((a) => a.id === id);
      if (index < 0) return json(res, 404, { error: 'Story not found.' });
      if (store.articles.some((a) => a.id !== id && a.slug === item.slug)) return json(res, 409, { error: 'A story with that slug already exists.' });
      const nextStore = clone(store);
      if (item.featured) nextStore.articles.forEach((a) => { a.featured = false; });
      nextStore.articles[index] = { ...nextStore.articles[index], ...item, updated_at: nowIso() };
      await persist(nextStore);
      return json(res, 200, { article: publicArticle(nextStore.articles[index]) });
    }
    if (match && method === 'DELETE') {
      const id = Number(match[1]); const index = store.articles.findIndex((a) => a.id === id); if (index < 0) return json(res, 404, { error: 'Story not found.' });
      const nextStore = clone(store);
      nextStore.articles.splice(index, 1);
      await persist(nextStore);
      return json(res, 200, { message: 'Story removed.' });
    }
  }
  return json(res, 404, { error: 'API route not found.' });
}
export async function handleRequest(req, res) {
  setSecurityHeaders(res);
  try {
    const host = req.headers.host || 'localhost'; const url = new URL(req.url || '/', `http://${host}`);
    if (IS_VERCEL && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/story/') || ['/feed.xml', '/sitemap.xml', '/robots.txt'].includes(url.pathname))) await loadStore();
    if (['/sitemap.xml', '/feed.xml', '/robots.txt'].includes(url.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      let body; let contentType;
      if (url.pathname === '/sitemap.xml') { body = buildSitemap(req); contentType = 'application/xml; charset=utf-8'; }
      else if (url.pathname === '/feed.xml') { body = buildFeed(req); contentType = 'application/rss+xml; charset=utf-8'; }
      else { body = `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/admin/\nSitemap: ${resolveSiteUrl(req)}/sitemap.xml\n`; contentType = 'text/plain; charset=utf-8'; }
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300', 'Content-Length': Buffer.byteLength(body) });
      return req.method === 'HEAD' ? res.end() : res.end(body);
    }
    const storyMatch = url.pathname.match(/^\/story\/([a-z0-9-]{1,100})\/?$/i);
    if (storyMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const page = renderStoryPage(req, storyMatch[1].toLowerCase());
      if (!page) return sendText(res, 404, 'Story not found.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(page) });
      return req.method === 'HEAD' ? res.end() : res.end(page);
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST, PUT, DELETE' });
      if (IS_VERCEL && hasPersistentRemoteStore && isStoreMutation(req.method, url.pathname)) {
        const release = await acquireStoreLock();
        try {
          await loadStore();
          return await handleApi(req, res, url);
        } finally { await release(); }
      }
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed.');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const fullPath = path.resolve(PUBLIC_DIR, `.${pathname}`);
    if (!fullPath.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
    let content;
    try { content = readFileSync(fullPath); } catch { return sendText(res, 404, 'Not found'); }
    const ext = path.extname(fullPath).toLowerCase();
    if (path.resolve(fullPath) === path.resolve(PUBLIC_DIR, 'index.html')) {
      let html = content.toString('utf8');
      const canonical = `${resolveSiteUrl(req)}/`;
      const socialImage = `${resolveSiteUrl(req)}/images/editorial-still-life.webp`;
      html = html.replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${htmlEscape(canonical)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${htmlEscape(canonical)}">`)
        .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${htmlEscape(socialImage)}">`)
        .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${htmlEscape(socialImage)}">`);
      content = Buffer.from(html);
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600', 'Content-Length': content.length });
    if (req.method === 'HEAD') return res.end();
    return res.end(content);
  } catch (error) {
    if (res.headersSent) return res.end();
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    const message = status === 503 ? error.message : (status >= 500 ? 'Something went wrong on the server.' : error.message);
    return json(res, status, { error: message });
  }
}

if (!IS_VERCEL) {
  const server = createServer(handleRequest);
  server.listen(PORT, () => console.log(`Offscript is running at http://localhost:${PORT}`));
}
