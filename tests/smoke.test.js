import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('production refuses example credentials from .env.example', () => {
  const directory = process.env.TMPDIR || os.tmpdir();
  const output = spawnSync(process.execPath, ['server.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production', PORT: '0', DATA_DIR: path.join(directory, `offscript-invalid-secrets-${process.pid}`),
      ADMIN_USERNAME: 'editor', ADMIN_PASSWORD: 'choose-a-unique-password-at-least-12-characters',
      SESSION_SECRET: 'replace-with-a-long-random-secret-at-least-32-characters',
    },
  });
  assert.notEqual(output.status, 0);
  assert.match(`${output.stderr}${output.stdout}`, /unique 32\+ character SESSION_SECRET/);
});

test('production rejects a predictable default admin username', () => {
  const output = spawnSync(process.execPath, ['server.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production', PORT: '0', DATA_DIR: path.join(os.tmpdir(), `offscript-default-user-${process.pid}`),
      ADMIN_USERNAME: 'editor', ADMIN_PASSWORD: 'a-unique-password-with-20-characters',
      SESSION_SECRET: 'a-random-enough-session-secret-value-for-production-tests',
    },
  });
  assert.notEqual(output.status, 0);
  assert.match(`${output.stderr}${output.stdout}`, /non-default ADMIN_USERNAME/);
});

test('Vercel function mode serves seeded content and refuses non-durable writes without Redis', { timeout: 15_000 }, async (t) => {
  const portProbe = createServer();
  await new Promise((resolve, reject) => portProbe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const entry = new URL('../server.js', import.meta.url).href;
  const runner = `import { createServer } from 'node:http'; const { handleRequest } = await import(${JSON.stringify(entry)}); createServer(handleRequest).listen(Number(process.env.PORT), '127.0.0.1');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', runner], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port), NODE_ENV: 'production', VERCEL: '1',
      ADMIN_USERNAME: 'test-editor', ADMIN_PASSWORD: 'Strong-test-password-2026',
      SESSION_SECRET: 'vercel-test-session-secret-with-more-than-32-characters',
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([stopped, delay(1000)]);
    }
  });
  let healthResponse;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vercel handler exited early:\n${logs}`);
    try { healthResponse = await fetch(`${origin}/api/health`); if (healthResponse.ok) break; } catch {}
    await delay(100);
  }
  assert.equal(healthResponse?.status, 200, `Handler did not become healthy. Logs:\n${logs}`);
  assert.equal((await healthResponse.json()).persistentStorage, false);
  const articles = await fetch(`${origin}/api/articles`);
  assert.equal(articles.status, 200);
  assert.equal((await articles.json()).articles.length, 17);
  const story = await fetch(`${origin}/story/the-art-of-noticing`);
  assert.equal(story.status, 200);
  assert.match(await story.text(), /property="og:type" content="article"/);
  const signup = await fetch(`${origin}/api/newsletter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'reader@example.com' }),
  });
  assert.equal(signup.status, 503);
  assert.match((await signup.json()).error, /Upstash Redis/i);

  const login = await fetch(`${origin}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username: 'test-editor', password: 'Strong-test-password-2026' }),
  });
  assert.equal(login.status, 503);
  assert.match((await login.json()).error, /storage is not connected/i);
  const saveWithoutSession = await fetch(`${origin}/api/admin/articles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ title: 'Not persisted', excerpt: 'Must stay read-only', category: 'Ideas', image: '/images/cover-ideas.svg', body: 'No Redis, no writes.' }),
  });
  assert.equal(saveWithoutSession.status, 401);
});

test('full-stack smoke test: public content, studio authentication, newsletter, RSS and sitemap', { timeout: 25_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'offscript-test-'));
  const portProbe = createServer();
  await new Promise((resolve, reject) => portProbe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      ADMIN_USERNAME: 'test-editor',
      ADMIN_PASSWORD: 'Strong-test-password-2026',
      SESSION_SECRET: 'test-session-secret-which-is-long-enough-for-this-suite',
      SITE_URL: 'https://offscript.example',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([stopped, delay(1500)]);
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  let healthResponse;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${logs}`);
    try {
      healthResponse = await fetch(`${origin}/api/health`);
      if (healthResponse.ok) break;
    } catch {}
    await delay(100);
  }
  assert.equal(healthResponse?.status, 200, `Server did not become healthy. Logs:\n${logs}`);
  assert.equal((await healthResponse.json()).ok, true);
  assert.match(healthResponse.headers.get('strict-transport-security') || '', /max-age=31536000/);

  const publicPage = await fetch(origin);
  assert.equal(publicPage.status, 200);
  const pageHtml = await publicPage.text();
  assert.match(pageHtml, /property="og:title"/);
  assert.match(pageHtml, /id="heroImage"/);
  assert.match(pageHtml, /editorial-still-life\.webp/);
  assert.match(pageHtml, /rel="canonical" href="https:\/\/offscript\.example\/"/);
  assert.match(pageHtml, /property="og:url" content="https:\/\/offscript\.example\/"/);

  const storyPage = await fetch(`${origin}/story/the-art-of-noticing`);
  assert.equal(storyPage.status, 200);
  const storyHtml = await storyPage.text();
  assert.match(storyHtml, /<title>The art of noticing what everyone else walks past — OFFSCRIPT<\/title>/);
  assert.match(storyHtml, /property="og:type" content="article"/);
  assert.match(storyHtml, /name="twitter:title" content="The art of noticing what everyone else walks past — OFFSCRIPT"/);
  assert.match(storyHtml, /property="og:url" content="https:\/\/offscript\.example\/story\/the-art-of-noticing"/);
  assert.match(storyHtml, /rel="canonical" href="https:\/\/offscript\.example\/story\/the-art-of-noticing"/);
  assert.equal((await fetch(`${origin}/story/not-a-real-story`)).status, 404);

  const articleResponse = await fetch(`${origin}/api/articles`);
  assert.equal(articleResponse.status, 200);
  const { articles } = await articleResponse.json();
  assert.equal(articles.length, 17);
  assert.match(articles[0].image, /^https:\/\/images\.unsplash\.com\//);

  const feedResponse = await fetch(`${origin}/feed.xml`);
  assert.equal(feedResponse.status, 200);
  assert.match(await feedResponse.text(), /<rss version="2\.0"/);
  const sitemapResponse = await fetch(`${origin}/sitemap.xml`);
  assert.equal(sitemapResponse.status, 200);
  const sitemapText = await sitemapResponse.text();
  assert.match(sitemapText, /<urlset/);
  assert.match(sitemapText, /https:\/\/offscript\.example/);
  assert.match(sitemapText, /https:\/\/offscript\.example\/story\/the-art-of-noticing/);
  const robotsResponse = await fetch(`${origin}/robots.txt`);
  assert.match(await robotsResponse.text(), /Disallow: \/api\/admin\//);

  const newsletterResponse = await fetch(`${origin}/api/newsletter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'reader@example.com' }),
  });
  assert.equal(newsletterResponse.status, 201);
  const duplicateNewsletter = await fetch(`${origin}/api/newsletter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'READER@example.com' }),
  });
  assert.equal(duplicateNewsletter.status, 200);

  const originlessLogin = await fetch(`${origin}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-editor', password: 'Strong-test-password-2026' }),
  });
  assert.equal(originlessLogin.status, 403, 'Production login must reject missing Origin headers.');

  const nonJsonLogin = await fetch(`${origin}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin }, body: '{"username":"test-editor"}',
  });
  assert.equal(nonJsonLogin.status, 415, 'JSON endpoints must reject non-JSON content types.');

  const loginResponse = await fetch(`${origin}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username: 'test-editor', password: 'Strong-test-password-2026' }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = (loginResponse.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^__Host-offscript_admin=/);
  assert.match(loginResponse.headers.get('set-cookie') || '', /; Secure/);
  const meResponse = await fetch(`${origin}/api/admin/me`, { headers: { Cookie: cookie } });
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json()).username, 'test-editor');

  const deniedCrossOrigin = await fetch(`${origin}/api/admin/articles`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'https://bad.example' },
    body: JSON.stringify({ title: 'Should not be saved' }),
  });
  assert.equal(deniedCrossOrigin.status, 403);

  const rejectedImage = await fetch(`${origin}/api/admin/articles`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ title: 'Rejected image', excerpt: 'A test', category: 'Ideas', author: 'Test', read_time: 2, image: 'https://attacker.example/track.jpg', body: 'Body', published: false }),
  });
  assert.equal(rejectedImage.status, 400, 'Remote images must use approved HTTPS photo hosts.');

  const createdResponse = await fetch(`${origin}/api/admin/articles`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      title: 'Testing a real publishing path', excerpt: 'A short test story used to validate publishing.', category: 'Ideas',
      author: 'OFFSCRIPT TEST', read_time: 2, slug: 'smoke-test-story', image: '/images/cover-ideas.svg',
      body: '# A Markdown heading\n\nA paragraph with **bold** text.', featured: false, published: true,
    }),
  });
  assert.equal(createdResponse.status, 201, await createdResponse.text());
  const publishedStory = await fetch(`${origin}/api/articles/smoke-test-story`);
  assert.equal(publishedStory.status, 200);
  assert.match((await publishedStory.json()).article.body, /^# A Markdown heading/);
  const updatedFeed = await fetch(`${origin}/feed.xml`);
  assert.match(await updatedFeed.text(), /Testing a real publishing path/);

  const protectedAdminPage = await fetch(`${origin}/api/admin/stats`);
  assert.equal(protectedAdminPage.status, 401);

  const loginAttempts = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await fetch(`${origin}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username: 'test-editor', password: 'wrong-password-for-rate-limit-test' }),
    });
    loginAttempts.push(response.status);
  }
  assert.deepEqual(loginAttempts.slice(0, 8), Array(8).fill(401));
  assert.equal(loginAttempts[8], 429, 'Repeated bad credentials must be rate limited.');
});
