# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm start           # Start dev server with hot reload (nodemon → test/dev/server.mjs)

# Testing
npm test            # Run all tests with c8 code coverage (95% threshold enforced)
npm run test-postdeploy  # Run post-deployment smoke tests only

# Run a single test file
npx mocha test/src/some-handler.test.js

# Linting
npm run lint        # ESLint across entire project

# Build & Deploy
npm run build       # Build with Helix Deploy (hedy)
npm run deploy      # Build + deploy to AWS Lambda + run tests
```

## Architecture Overview

This is an **AWS Lambda-based REST API** for the Adobe Helix admin interface. It is an ES module project (`"type": "module"`) targeting Node 22.

### Request Pipeline

Requests flow through a middleware wrapper chain before reaching handlers:

```
API Gateway → Router → Wrappers (catchAll → adminContext → bodyData → secrets → ...) → Handler → Response
```

Wrappers are composed via `.with()` chains and execute in reverse order on the response. Key wrappers live in `src/wrappers/`.

### Custom Router (`src/router/`)

A tree-based path router (not Express). Routes support:
- Literal segments and named params (`:org`, `:site`, `:ref`)
- Wildcard `*` segments
- Optional query parameter matching

Routes are registered in `src/index.js` which is the Lambda entry point.

### AdminContext (`src/support/AdminContext.js`)

The central context object passed to every handler. It wraps the Helix Universal context and provides:
- Lazy-loaded site and org config (`context.loadConfig(info)`)
- AWS/integration clients (SQS, S3, Lambda)
- Auth state and token caching
- Redirect helpers

### RequestInfo (`src/support/RequestInfo.js`)

Parses route variables (`org`, `site`, `ref`, path, extension) and computes web vs. resource paths. Passed alongside context to every handler.

### Handlers (`src/`)

Each feature area is a subdirectory with its own handler module:
- `src/auth/` — OAuth/OIDC flows, multi-IDP support (Adobe IMS, Google, Microsoft, GitHub)
- `src/cache/` — CDN cache purge (Fastly, CloudFlare, Akamai, CloudFront, managed)
- `src/preview/`, `src/live/` — Content preview and live serving
- `src/source/` — Document source management (GET/POST/PUT/DELETE)
- `src/code/` — GitHub code access
- `src/media/` — Media/asset handling
- `src/index/` — Search indexing via SQS
- `src/job/` — Async job management
- `src/sitemap/` — Sitemap generation
- `src/status/` — Site status checks
- `src/contentproxy/` — Content proxying

### Authentication & Authorization (`src/auth/`)

- Multiple identity providers configured in `src/idp-configs/`
- JWT validation via `jose` against JWKS endpoints
- Session cookies (secure, httponly, samesite)
- Role mapping from site/org config files
- CSRF protection for sidekick integration

### Error Handling

Use `StatusCodeError` for HTTP error responses and `AccessDeniedError` for authorization failures. The `catchAll` wrapper converts unhandled errors to HTTP responses.

### Testing Conventions

- Tests live in `test/` mirroring `src/` structure
- HTTP calls are mocked with `nock`
- Test environment setup in `test/setup-env.js` and `test/setup-test-idp.js`
- Dev server for integration testing at `test/dev/server.mjs`
- Coverage thresholds: 95% for lines, branches, statements, and functions

### Key Integrations

- **GitHub**: Octokit REST + Auth App OAuth
- **Content sources**: OneDrive/SharePoint and Google Drive via `@adobe/helix-*` libs
- **CDN**: Fastly, CloudFlare, Akamai, CloudFront cache purge
- **AWS**: Lambda invocation, SQS for async jobs, S3 for storage
- **Deployment**: `@adobe/helix-deploy` (hedy CLI), semantic-release for automated versioning
