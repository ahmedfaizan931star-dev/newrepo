# Security and production readiness

OFFSCRIPT has a small dependency-free Node.js server, a browser-based publishing Studio, and a single JSON document stored locally or in Upstash Redis on Vercel.

## Controls in this repository

- Production startup rejects placeholder passwords/secrets and predictable default admin usernames.
- Admin sessions are signed, include a random nonce, expire after four hours, and use `HttpOnly`, `SameSite=Strict`, and production `Secure` cookies.
- Browser sign-in, newsletter, and admin mutation requests use same-origin checks. JSON endpoints reject non-JSON request bodies and requests larger than 40 KiB.
- Sign-in and newsletter submissions have rate limits; Vercel uses Redis counters when configured.
- Article covers are restricted to bundled local artwork or HTTPS image hosts `images.unsplash.com` and `images.pexels.com`.
- User-authored article text is rendered as escaped Markdown, not raw HTML. Security headers include a Content Security Policy, frame protection, HSTS in production, and `nosniff`.
- Vercel Studio sign-in and writes fail closed without Redis and use a Redis lease for article/newsletter mutations; in-memory state is only committed after the storage write succeeds.
- Automated tests cover production credential checks, Vercel read-only behavior without Redis, same-origin checks, JSON content-type validation, approved image hosts, article CRUD, newsletter capture, rate limiting, RSS and sitemap routes.

## Operational gaps to address before a sensitive or high-traffic publication

This is a hardened starter, not a formal security audit or a guarantee of zero vulnerabilities. The Studio currently has one environment-configured account and no MFA, multi-user roles, password recovery, per-session server-side revocation, or audit log. Subscriber email addresses are personal data; protect Redis and project access, restrict exports, define a retention policy, and use backups. Newsletter capture only stores addresses; it does not send confirmation or campaign emails. Have the deployed site reviewed and test recovery, rate limiting, backups, and access controls before using it for sensitive data or a high-traffic publication.

## Secrets

Never commit `.env`, production credentials, subscriber exports, or Redis values. Rotate the `SESSION_SECRET` and admin credentials immediately if exposed. Keep Preview and Production credentials separate where practical.
