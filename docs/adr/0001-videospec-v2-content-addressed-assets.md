# ADR 0001: VideoSpec v2 uses content-addressed asset references

- Status: Accepted
- Date: 2026-10-12
- Related issue: #16

## Context

VideoSpec v1 identifies assets with logical IDs, kinds, and `static:<path>` URIs. That leaves byte identity implicit until render time and makes reusable asset identity path-dependent.

The repository already intends to align with the durable `asset-tooling` `AssetRef` contract mirrored by `remotion-primitives`.

## Decision

Adopt **VideoSpec v2** for asset references and do not retain a VideoSpec v1 read path.

Each `assets[]` entry is a logical slot whose concrete asset is represented by the shared `AssetRef` v1 shape, including content identity, media type, byte length, kind, schema version, and metadata.

Asset bytes live in a shared git-ignored content-addressed store keyed by SHA-256. Existing checked-in source assets may be imported into that store; later acquisition/materialization remains outside renderer components.

Before rendering, the render job resolves each logical slot to an immutable runtime input such as `{ src, sha256, byteLength, mediaType }`. Missing assets, mismatched bytes, or incompatible media types fail before bundling. Renderer components do not receive provider-specific acquisition requests or `static:` asset URIs.

Existing VideoSpec v1 fixtures are migrated to v2 rather than supported through a compatibility reader.

## Consequences

- One content identity can be reused by multiple projects without duplicating asset authority.
- Validation can check references and media compatibility without reading large bytes.
- Asset acquisition/cache policy stays outside the React renderer.
- The migration is intentionally breaking for VideoSpec v1; there is no permanent dual-authority path.
