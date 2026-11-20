# 0043 — Global navigation drawer

Status: Accepted. Date: 2026-11-20.

Replace the header's settings/theme dropdown with an overlay drawer containing
real app destinations and current-party context. Use a native modal dialog and
shared controls. An overlay at all widths keeps page geometry stable and leaves
the mobile-first content layout intact. Desktop pinning can be considered later.

Training reference mechanics require a game, so its drawer destination uses the
selected party and explains that context. No separate duplicate Pokédex screen
or new global game preference is introduced. Frequent actions remain on-page.
Keep route dispatch in app.ts and guide behavior in the roster page; shell
navigation must not import page internals. Retain hash routes and utility return
paths, with one sticky app header and the existing page action bars below it.

The drawer opens on the right, matching the right-hand Menu trigger. Review
trigger and panel together, including opening side and the exposed backdrop.
Use shared SVG icons. Per ADR 0044, navigation uses normal ink, stronger
text and a small current-page checkmark, without a filled pill or accent stripe.
The title, row labels, descriptions and Theme label share one text gutter.
