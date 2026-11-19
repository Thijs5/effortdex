# 0039 — iPhone 13 is the default mobile review viewport

Date: 2026-11-19

Status: Accepted. Refines [ADR 0030](0030-phone-layout-and-visual-regression-review.md).

## Context

The Training guide's EV values were reported wrapping past the card on an iPhone 13. A narrower phone check can miss a defect when it activates a different layout breakpoint.

## Decision

- Start mobile UI reviews at **390 × 844 CSS pixels**, the iPhone 13 full-height viewport. Capture the changed flow in light and dark mode and inspect the actual screenshots.
- Check real data and the states that change the layout. For numeric values, assert that the rendered values stay within their card and remain readable. Include larger text for layouts where numbers share space with charts or controls.
- Supplement the default with narrower widths, short or keyboard-constrained views, and desktop as appropriate. For Safari-specific reports, reproduce on an iPhone or run WebKit mobile emulation when available. Record which environment was used.

## Consequences

The visual review suite keeps the iPhone 13 viewport as its primary mobile baseline. WebKit emulation provides browser-engine coverage. Native Safari settings and installed-PWA behavior still require a device check.
