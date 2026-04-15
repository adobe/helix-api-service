# Snapshots

The snapshot feature provides content versioning and approval workflows for AEM Helix sites. It allows capturing frozen copies of content resources, managing review cycles, and publishing approved content to live — all without touching the live partition directly.

## What is a Snapshot?

A **snapshot** is a named collection of content resources — a point-in-time copy of site content taken from the `preview` (or `live`) partition and stored in a dedicated area under `preview/.snapshots/{snapshotId}/`.

Think of it as a staging area for content changes. Authors add resources to a snapshot, optionally lock it for review, and then publish the entire batch to `live` — without ever modifying `live` directly until approval.

### Core use cases

- **Content versioning** — capture the current state of pages before a release
- **Approval workflows** — lock a batch, request review, approve or reject
- **Safe bulk publishing** — publish a curated set of changes atomically
- **Deletion tracking** — mark resources as "to be deleted from live" (status 404 in manifest)

## Terminology

| Term | Definition |
|------|-----------|
| **Snapshot** | A named collection of content resources stored under `preview/.snapshots/{snapshotId}/`. Identified by a user-chosen `snapshotId` string (e.g. `"default"`, `"release-v2"`) |
| **Snapshot ID** | Unique string identifier for a snapshot. User-chosen, not auto-generated |
| **Manifest** | A JSON metadata file (`.manifest.json`) stored alongside the snapshot resources. Tracks which resources belong to the snapshot, their status, and review/lock state |
| **Resource** | An individual content file within a snapshot. Has a `path` (web path) and a `status` (`STATUS_EXISTS` = 200, `STATUS_DELETED` = 404) |
| **Locked** | A snapshot state that prevents further edits. Set via explicit lock or as part of review request. Stored as an ISO timestamp in the manifest |
| **Review** | Approval workflow state: `"requested"` (locked, awaiting approval), `"rejected"` (unlocked, edits allowed), or absent (no review in progress) |
| **fromLive** | Boolean flag set at snapshot creation. When `true`, resources are copied from the `live` partition instead of `preview` |
| **Content Bus ID** | S3 bucket identifier for a site, resolved from org/site config |
| **Partition** | Top-level S3 directory: `preview/` or `live/`. Snapshots live under `preview/.snapshots/` |
| **Web Path** | User-facing path without file extension (e.g. `/blogs/post`) |
| **Resource Path** | S3 key path with extension (e.g. `/blogs/post.md`) |

## Manifest

Each snapshot has a manifest stored at `{contentBusId}/preview/.snapshots/{snapshotId}/.manifest.json`. The manifest tracks metadata and the full list of resources:

```json
{
  "id": "release-v2",
  "created": "2025-03-24T10:00:00Z",
  "lastModified": "2025-03-24T11:20:00Z",
  "lastUpdated": "2025-03-24T11:30:00Z",
  "locked": "2025-03-24T11:15:00Z",
  "title": "Release v2.1",
  "description": "Sprint 14 content updates",
  "metadata": { "ticket": "PROJ-123" },
  "review": "requested",
  "fromLive": false,
  "resources": [
    { "path": "/welcome", "status": 200 },
    { "path": "/old-page", "status": 404 }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Snapshot identifier |
| `created` | ISO 8601 | Auto-set when manifest is first stored |
| `lastModified` | ISO 8601 | Updated on any manifest change |
| `lastUpdated` | ISO 8601 | Updated when a resource is added or removed |
| `locked` | ISO 8601 | Timestamp when locked; absent when unlocked |
| `title` | string | User-settable, max 4 KB |
| `description` | string | User-settable, max 16 KB |
| `metadata` | object | User-settable arbitrary JSON, max 512 KB |
| `review` | string | `"requested"`, `"rejected"`, or absent |
| `fromLive` | boolean | Source partition flag, set at creation |
| `resources` | array | `{ path, status }` entries, sorted alphabetically |

### Resource status values

| Status | Meaning |
|--------|---------|
| `200` | Resource exists in the snapshot and will be copied to live on publish |
| `404` | Resource is marked for deletion — will be removed from live on publish |
| `304` | Resource was not modified since last snapshot (bulk operations only, transient) |

## Storage Layout

Snapshot content is stored alongside regular preview/live content in the content bus:

```
{contentBusId}/
  preview/
    .snapshots/
      {snapshotId}/
        .manifest.json           <- manifest for this snapshot
        path/to/resource.md      <- snapshotted resource
      another-snapshot/
        .manifest.json
    regular-content.md           <- normal preview content
  live/
    path/to/resource.md          <- published content
```

Resources are copied from `preview` (default) or `live` (when `fromLive: true`) into the snapshot partition. On publish, they are copied from the snapshot partition to `live`.

## API

### URL pattern

```
/:org/sites/:site/snapshots[/:snapshotId][/*path]
```

Only the `main` branch is supported (implicit, not in the URL).

### Endpoints

#### GET — Read

| Request | Description | Permissions |
|---------|-------------|-------------|
| `GET …/snapshots` | List all snapshots for a site | `snapshot:read` |
| `GET …/snapshots/{id}` | Get the snapshot manifest | `snapshot:read` |
| `GET …/snapshots/{id}/{path}` | Get resource status within a snapshot | `snapshot:read` |

#### POST — Write

| Request | Description | Permissions |
|---------|-------------|-------------|
| `POST …/snapshots/{id}` | Update manifest metadata (title, description, metadata) | `snapshot:write` |
| `POST …/snapshots/{id}` + `{ locked: true }` | Lock the snapshot | `snapshot:write`, `preview:write` |
| `POST …/snapshots/{id}` + `{ locked: false }` | Unlock the snapshot | `snapshot:write`, `live:write` |
| `POST …/snapshots/{id}` + `{ review: "..." }` | Request, approve, or reject review | `snapshot:write` + varies |
| `POST …/snapshots/{id}` + `{ publish: "true" }` | Publish entire snapshot to live | `live:write` |
| `POST …/snapshots/{id}/{path}` | Add/update a single resource | `snapshot:write` |
| `POST …/snapshots/{id}/{path}` + `{ publish: "true" }` | Publish a single resource to live | `live:write` |
| `POST …/snapshots/{id}/*` + `{ paths: [...] }` | Bulk add/update resources | `snapshot:write` |

#### DELETE — Remove

| Request | Description | Permissions |
|---------|-------------|-------------|
| `DELETE …/snapshots/{id}` | Delete an empty snapshot | `snapshot:delete` |
| `DELETE …/snapshots/{id}/{path}` | Remove a resource from the snapshot | `snapshot:delete` |
| `DELETE …/snapshots/{id}/*` + `{ paths: [...] }` | Bulk remove resources | `snapshot:delete` |

## Review Workflow

```
[create snapshot] -> [add resources] -> [request review] -> [approve / reject]
                                              | lock              | approve -> publish to live
                                                                  | reject  -> unlock
```

1. **Request review** (`{ review: "request" }`) — locks the snapshot to prevent further edits, sets `review: "requested"`. Sends `review-requested` notification.
2. **Approve** (`{ review: "approve" }`) — publishes all `200`-status resources to live, removes all `404`-status resources from live, then optionally clears the snapshot resources (unless `keepResources: true`). Unlocks the snapshot. Requires `snapshot:delete` + `live:write`. Sends `review-approved` notification.
3. **Reject** (`{ review: "reject" }`) — unlocks the snapshot, sets `review: "rejected"`, allowing further edits. Sends `review-rejected` notification.

## Bulk Operations

For bulk snapshot or remove operations with a `paths` array in the request body:

- **≤ 200 paths** — executed synchronously as a transient job
- **> 200 paths** — rejected with 400 (use `forceAsync=true` to override)

Paths are processed via `processPrefixedPaths`: wildcard paths (e.g. `/docs/*`) become prefix entries that list all matching resources from the source partition, while single paths are resolved individually. Paths covered by a broader wildcard are automatically deduplicated.

Bulk jobs run in two phases:

1. **Prepare** — resolve prefix entries by listing the source partition, check modification times for single paths
2. **Perform** — copy/delete resources in concurrent batches of 50, update the manifest, purge the cache, send notifications

## Publishing

There are two ways to publish snapshot content to live:

### Direct publish (no review)

`POST …/snapshots/{id} { publish: "true" }` — requires `live:write`.

For the entire snapshot (no path or `/*` suffix): splits manifest resources by status:
- Status `200` resources are bulk-published to live (copy from snapshot partition to live)
- Status `404` resources are bulk-removed from live

For a single resource (with path): publishes or removes just that resource.

### Review approve

`POST …/snapshots/{id} { review: "approve" }` — requires `snapshot:delete` + `live:write`.

Same publish/remove logic as direct publish, but also unlocks the manifest, clears the review state, and optionally removes all snapshot resources.

### How publish works internally

The snapshot publish delegates to the existing live publish pipeline. The live pipeline is snapshot-aware: when `info.snapshotId` is present (propagated via `RequestInfo.clone` which preserves router variables), it reads resources from `preview/.snapshots/{snapshotId}/` instead of `preview/`, and copies them to `live/`. This ensures snapshot publishes get the same side effects as normal publishes: redirect handling, index updates, sitemap updates, and cache purging.

```
snapshot/publish.js
  -> live/bulk-publish.js (reads info.snapshotId, transient job)
    -> PublishJob.prepare() reads from /.snapshots/{id}/ instead of preview/
    -> liveUpdate() calls publishSnapshot() instead of contentBusCopy()
      -> S3 copy: preview/.snapshots/{id}{path} -> live{path}
```

## Permissions

| Permission | Required for |
|------------|-------------|
| `snapshot:read` | List snapshots, get manifest, get resource status |
| `snapshot:write` | Create/update resources, request/reject review, update metadata |
| `snapshot:delete` | Delete snapshots/resources, approve review |
| `preview:write` | Lock snapshots |
| `preview:list` | Wildcard/bulk operations |
| `live:write` | Unlock snapshots, publish to live |
