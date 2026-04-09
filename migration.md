# helix-admin → helix-api-service Migration

## Overview

`helix-api-service` is a ground-up rewrite of `helix-admin` targeting AWS Lambda + Node 22, using
a custom tree-based router and a middleware wrapper chain. Migration of features from helix-admin
has been ongoing since mid-2024. This document tracks what has been ported and what is still
outstanding, so future work can be prioritized and cross-referenced.

**Research scope**: helix-admin git history since Jun 2024 (~2,200 commits), CHANGELOG v12.99–12.126.

helix-admin repository: https://github.com/adobe/helix-admin
helix-api-service repository: https://github.com/adobe/helix-api-service

---

## Completed ✓

These features from helix-admin have already been ported or implemented in helix-api-service:

- [x] Bulk publish (POST /live/*) — helix-admin equiv
- [x] Bulk preview & bulk remove from preview — helix-admin equiv
- [x] Token redaction from logs (imsToken, codeSource) — helix-admin [#3560](https://github.com/adobe/helix-admin/pull/3560), [#3558](https://github.com/adobe/helix-admin/pull/3558)
- [x] WebP + AVIF in media fetch Accept header — helix-admin [#3455](https://github.com/adobe/helix-admin/pull/3455)
- [x] `log:write` in publish role — helix-admin [#3515](https://github.com/adobe/helix-admin/pull/3515)
- [x] GitHub rate limit retry logic — helix-admin [#3436](https://github.com/adobe/helix-admin/pull/3436), [#3315](https://github.com/adobe/helix-admin/pull/3315)
- [x] `/.helix/` exclusion from indexing — helix-admin [#3342](https://github.com/adobe/helix-admin/pull/3342)
- [x] SVG limits support and validation — helix-admin [#3513](https://github.com/adobe/helix-admin/pull/3513)
- [x] JTI allow list validation for wildcard org API keys — helix-admin [#3297](https://github.com/adobe/helix-admin/pull/3297)
- [x] `originalSite` tracking in discover — helix-admin [#3448](https://github.com/adobe/helix-admin/pull/3448)
- [x] `processQueue` usage in index and discover — helix-admin [#3543](https://github.com/adobe/helix-admin/pull/3543)
- [x] `forceSync` / `forceAsync` — helix-admin [#3246](https://github.com/adobe/helix-admin/pull/3246)
- [x] Versioning API (`src/source/versions.js`)
- [x] List branches (`src/code/list-branches.js`)
- [x] Trusted hosts enforcement (`src/sidekick/csrf.js`) — helix-admin [#3155](https://github.com/adobe/helix-admin/pull/3155)
- [x] Config route (`/config`) — helix-admin equiv
- [x] IMS profile fetch for bearer tokens (`src/auth/support.js`) — helix-admin [#3444](https://github.com/adobe/helix-admin/pull/3444)
- [x] Reindex via POST `/discover/*` — helix-admin equiv

---

## Pending — Major Features

These require porting entire modules or large subsystems from helix-admin.

- ~~**Port cron module (scheduled job execution)**~~ ~~[adobe/helix-api-service#174](https://github.com/adobe/helix-api-service/issues/174)~~ **DEPRECATED — will not be ported**
  ~~Cron-style scheduling for preview/live/publish/unpublish/http/process commands.~~
  ~~helix-admin: `src/cron/` — handler.js, execute.js, schedule.js, utils.js, preview.js.~~
  ~~helix-admin PRs: [#3286](https://github.com/adobe/helix-admin/pull/3286), [#3282](https://github.com/adobe/helix-admin/pull/3282), [#3283](https://github.com/adobe/helix-admin/pull/3283), [#3301](https://github.com/adobe/helix-admin/pull/3301), [#3244](https://github.com/adobe/helix-admin/pull/3244), [#3346](https://github.com/adobe/helix-admin/pull/3346).~~

- [ ] **Port PSI (PageSpeed Insights) endpoint** — [adobe/helix-api-service#175](https://github.com/adobe/helix-api-service/issues/175)
  Proxy to Lighthouse/PSI, validates URL against org/site config, adds site auth tokens.
  Supports both .aem.page and .aem.live URL formats, mobile/desktop strategies.
  helix-admin: `src/psi/handler.js`.

- [ ] **Port snapshot module** — [adobe/helix-api-service#176](https://github.com/adobe/helix-api-service/issues/176)
  Content snapshot management: CRUD, bulk ops, review/publish workflow, manifests.
  helix-admin: `src/snapshot/` — 12+ files including bulk-snapshot.js, manifest.js, review.js, publish.js, etc.

- [ ] **Port medialog module** — [adobe/helix-api-service#177](https://github.com/adobe/helix-api-service/issues/177)
  Media event logging endpoint: GET (query with time-range, pagination, next token) + POST (add entries).
  helix-admin: `src/medialog/` — handler.js, add.js, query.js.
  helix-admin PRs: [#3450](https://github.com/adobe/helix-admin/pull/3450), [#3478](https://github.com/adobe/helix-admin/pull/3478), [#3509](https://github.com/adobe/helix-admin/pull/3509), [#3486](https://github.com/adobe/helix-admin/pull/3486).

- [x] **Index bulk operations** — [adobe/helix-api-service#178](https://github.com/adobe/helix-api-service/issues/178)
  helix-api-service's index module is greatly simplified vs helix-admin. Missing: bulk-index.js,
  index-job.js, partitioner.js, fetch-page.js, index-page.js, remove-page.js, remove-pages.js,
  row-count.js, index preview/publish. Also: `indexNames` param ([#3333](https://github.com/adobe/helix-admin/pull/3333)),
  skip record > 100 KB ([#3476](https://github.com/adobe/helix-admin/pull/3476)),
  skip downloading index JSONs for sites with many indexes ([#3475](https://github.com/adobe/helix-admin/pull/3475)).

- ~~**Status bulk operations (POST /status)**~~ ~~[adobe/helix-api-service#179](https://github.com/adobe/helix-api-service/issues/179)~~ **DEPRECATED — will not be ported**
  ~~helix-admin supports POST /status for bulk status checks; helix-api-service only has GET.~~
  ~~helix-admin: `src/status/handler.js` POST → `bulkStatus()`.~~
  Functionality will be replaced by a dedicated API to browse the preview and live partitions — see [adobe/helix-api-service#123](https://github.com/adobe/helix-api-service/issues/123).

---

## Pending — Smaller Fixes & Features

Individual improvements from helix-admin not yet in helix-api-service.

- [ ] **WebP image support in preview upload** — [adobe/helix-api-service#180](https://github.com/adobe/helix-api-service/issues/180)
  helix-admin added WebP to `src/preview/media-upload.js` MEDIA_TYPES. helix-api-service has WebP
  in the fetch Accept header but no media-upload equivalent in the preview pipeline.
  helix-admin PR: [#3549](https://github.com/adobe/helix-admin/pull/3549).

- [ ] **Sitemap improvements (ETag, canonical, CDN host)** — [adobe/helix-api-service#181](https://github.com/adobe/helix-api-service/issues/181)
  Three sitemap improvements missing: (1) ETag-based metadata change detection to skip unnecessary
  reindexing ([#3523](https://github.com/adobe/helix-admin/pull/3523), [#3524](https://github.com/adobe/helix-admin/pull/3524));
  (2) respect `canonical` meta tag when building sitemap ([#3378](https://github.com/adobe/helix-admin/pull/3378));
  (3) trigger sitemap rebuild when CDN host config changes ([#3502](https://github.com/adobe/helix-admin/pull/3502)).

- [ ] **Primary/canonical site restrictions** — [adobe/helix-api-service#182](https://github.com/adobe/helix-api-service/issues/182)
  Prevent unpublish/unpreview on non-primary (aliased) sites ([#3413](https://github.com/adobe/helix-admin/pull/3413));
  restrict code operations to canonical site only ([#3442](https://github.com/adobe/helix-admin/pull/3442)).
  helix-api-service live/, preview/, code/ have no primary-site gating.

- [ ] **Media bucket name parameter in contentproxy** — [adobe/helix-api-service#183](https://github.com/adobe/helix-api-service/issues/183)
  Pass configurable media bucket name as a parameter to contentproxy handlers.
  helix-admin PR: [#3323](https://github.com/adobe/helix-admin/pull/3323).
  helix-api-service `src/contentproxy/` has no media bucket parameter.

- [ ] **`/auth/adobe/exchange` route for IMS token exchange** — [adobe/helix-api-service#184](https://github.com/adobe/helix-api-service/issues/184)
  helix-admin wired up `/auth/adobe/exchange` for direct IMS access token exchange
  (distinct from the standard OAuth code flow). `exchangeImsToken()` and `detectTokenIDP()` are
  missing from helix-api-service's `src/auth/exchange-token.js` and login handler.
  helix-admin: `src/login/login.js:206`, `src/auth/exchange-token.js:340`.

- [ ] **CDN host in discover inventory** — [adobe/helix-api-service#185](https://github.com/adobe/helix-api-service/issues/185)
  helix-admin inventory includes `cdn.prod.host`; helix-api-service `src/discover/inventory.js`
  schema does not include a CDN host field.
  helix-admin PRs: [#3458](https://github.com/adobe/helix-admin/pull/3458), [#3530](https://github.com/adobe/helix-admin/pull/3530).

- [ ] **Media upload size limit enforcement** — [adobe/helix-api-service#186](https://github.com/adobe/helix-api-service/issues/186)
  helix-admin enforces per-project file size limits for media uploads and added a single
  configurable video size limit. Verify helix-api-service `src/media/validate.js` applies equivalent limits.
  helix-admin PRs: [#3300](https://github.com/adobe/helix-admin/pull/3300), [#3264](https://github.com/adobe/helix-admin/pull/3264), [#3539](https://github.com/adobe/helix-admin/pull/3539).
