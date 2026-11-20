# 0041 — Reuse-first component catalog

Date: 2026-11-20

Status: Accepted. Extends ADRs 0003, 0019 and 0040.

## Context

Shared tokens, CSS primitives and Web Components already exist, but their usage
contracts are scattered across source files. Agents can recreate controls or
introduce local styling without discovering the established pattern. The
development review loop needs a practical reference for visual consistency.

## Decision

- Keep the component contracts and selection rules in `docs/components.md`.
  Agent guidance requires reuse → composition → extension before creation,
  with a concrete gap justifying new shared components.
- Serve a live catalog at `/components/`, with `/components` canonicalized to
  it. Use actual shared styles and Web Components; keep previews independent of
  application services and saved state. Demonstrate generic controls locally
  and review store-aware compositions in their real feature flows.
- Build the catalog as a separate entry point and static directory, retaining
  relative asset resolution for project-subpath deployments. Precache its
  artifacts and use its own offline navigation fallback.
- Update reference contracts and relevant live examples alongside changes to
  shared components. Use focused behavior/layout checks and visual inspection;
  a catalog does not replace review of the user's complete task.

## Consequences

New UI tasks have a discoverable starting point without another UI framework or
documentation dependency. The catalog and app share implementation changes, but
their independently bundled entry points duplicate some code in build output.
Documentation and example coverage still require maintenance. Feature-specific
layout remains local until real common contracts justify a shared abstraction.
