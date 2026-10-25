# OFFSCRIPT — technology choices (reviewed 25 October 2026)

## Runtime: Node.js 24.22.1 LTS

The Node.js release schedule lists v24 as Active LTS, and the official release list shows v24.22.1 published on 21 October 2026. Node 26 is the Current line and is scheduled to enter LTS on 28 October 2026, so this build pins the stable LTS patch available on the review date rather than using the newest non-LTS line.

- https://github.com/nodejs/Release#release-schedule
- https://nodejs.org/tr/blog/release/v24.22.1

## Hosting: persistent storage is not optional for a CMS

The app stores stories and subscriber records in JSON. The Render Blueprint mounts a persistent disk at `/var/data`, and `DATA_DIR` redirects writes there. Render documents that ordinary service filesystems are ephemeral, while persistent disks are only available to paid web services and preserve writes across restarts and deploys. That matters because a deploy which loses the content directory would lose edits and signups. This storage pattern is for a small, single-instance publication; a larger multi-instance service should move to a managed database.

- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec

## Photography: real editorial images, responsive requests, graceful degradation

Starter stories point to the Unsplash image CDN using curated image IDs and width-specific URLs. Browser `srcset` selects a suitable image width. A service worker can cache viewed remote images after an online visit, and every story retains a local SVG fallback so the site remains usable when the photo host is unavailable. The public article view includes a photo-source note; the source set and license references are in `PHOTO-CREDITS.md`.

Unsplash's license allows free personal and commercial use, with attribution appreciated. If the site later adds live photo search through the official Unsplash API, the app must follow its current API hotlinking rules and use the URLs returned by that API rather than treating this hand-curated set as an API integration.

- https://unsplash.com/license
- https://unsplash.com/documentation
- https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images

## Small, low-dependency architecture

The frontend remains semantic HTML, custom CSS, and native JavaScript rather than adding a framework only for marketing pages. The server uses Node's built-in HTTP, crypto, filesystem, and URL modules. This makes the app small, easier to run locally, and straightforward to deploy as a Node service or container. A built-in Node test suite checks health, publishing, authentication, CSRF origin checks, newsletter persistence, feed and sitemap routes.

## Security and distribution basics

Production boot rejects placeholder passwords/secrets and common admin usernames. Admin sessions use a signed four-hour `__Host-` cookie in production, same-origin checks protect browser mutations, sign-in and newsletter traffic are rate-limited, and security headers are applied. Article covers are restricted to bundled artwork or approved Unsplash/Pexels image hosts. Vercel writes fail closed without Redis and use a short Redis lease for mutations. RSS and sitemap routes are generated from published entries, and CI runs syntax checks and integration tests before deployment.
