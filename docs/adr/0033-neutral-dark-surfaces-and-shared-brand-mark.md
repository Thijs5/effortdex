# 33. Neutral dark surfaces and a shared Poké Ball-inspired mark

## Status

Accepted; updates the dark palette and visual identity from ADR 0028.

## Decision

- Use neutral charcoal surfaces and cool-grey borders/text for both automatic and manually selected dark mode. Keep red as a deliberate action/brand accent, rather than tinting large dark backgrounds. Suppress species-colour page and roster-card washes in dark mode while preserving type badges and stat semantics.
- Browser chrome follows the effective surface colour, including manual choices that differ from the OS theme. Light surfaces remain paper-toned.
- Keep compact outer page gutters, but give nested party cards and item buttons a consistent internal inset and 44px target height. Avoid solving cramped nested controls by widening every ancestor.
- Use one code-native SVG Poké Ball-inspired mark in the header and favicon. Generate standard, maskable, and Apple touch PNG icons from matching SVG artwork; keep the mark inside the maskable safe area. The existing small network indicator remains attached to the mark.
- Include the header SVG in the offline shell cache. Review all route/dialog screenshots at the iPhone 13 baseline in light/dark mode and on desktop, including controls after nesting and browser-theme changes.
