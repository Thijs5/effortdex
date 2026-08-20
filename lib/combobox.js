// Shared combobox behavior for the two suggestion-dropdown components
// (<pokemon-search> and <game-version-picker>). Extracted after the two
// diverged on exactly this logic: pokemon-search fixed an iOS bug where
// preventDefault() on a touch's pointerdown cancels the scroll gesture
// (making the list unscrollable, since nearly every touch starts on an
// option) while game-version-picker still had the broken pattern. One
// implementation means the next fix lands in both.

/**
 * Wires tap/click selection on a suggestion `<ul>` whose pickable rows
 * are `li.option` elements. Selection resolves on pointerup, not
 * pointerdown, and pointerdown is only preventDefault()ed for mouse —
 * preserving focus on the input for mouse picks without breaking touch
 * scrolling. A small movement threshold tells a tap from the start of a
 * scroll drag. Calls `pick(li)` with the chosen row.
 */
export function attachPointerSelection($list, pick) {
  let downLi = null;
  let downX = 0;
  let downY = 0;
  $list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li.option');
    if (!li) return;
    downLi = li;
    downX = e.clientX;
    downY = e.clientY;
    if (e.pointerType === 'mouse') e.preventDefault();
  });
  $list.addEventListener('pointerup', (e) => {
    const li = downLi;
    downLi = null;
    if (!li) return;
    const movedTooFar = Math.hypot(e.clientX - downX, e.clientY - downY) > 10;
    if (movedTooFar || e.target.closest('li.option') !== li) return;
    pick(li);
  });
}

/**
 * Reflects the highlighted option to assistive tech: gives each
 * `li.option` a stable id under `idPrefix`, marks the active one with
 * `aria-selected`, and points the input's `aria-activedescendant` at it
 * (clearing it when nothing is active). Call on every highlight change;
 * call with activeIndex -1 after (re)rendering the list.
 */
export function syncActiveDescendant($input, items, activeIndex, idPrefix) {
  items.forEach((li, i) => {
    if (!li.id) li.id = `${idPrefix}-${i}`;
    li.setAttribute('aria-selected', String(i === activeIndex));
  });
  const active = items[activeIndex];
  if (active) $input.setAttribute('aria-activedescendant', active.id);
  else $input.removeAttribute('aria-activedescendant');
}
