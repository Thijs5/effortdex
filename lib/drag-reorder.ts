// Pointer-driven drag-to-reorder for a grid/list of sibling elements —
// not native HTML5 drag-and-drop, which doesn't fire from touch on mobile
// browsers. Press the handle, drag up/down; whichever neighbor the
// pointer is nearest gets highlighted as the drop target, and only on
// release does the dragged element actually move: a single DOM reorder
// plus one `onDrop` call, since only the dragged element needs to move —
// everything else just shifts to make room. Generic over what's being
// reordered (currently only components/pages/parties/roster.js's cards) so the gesture
// itself stays in one place if a second reorderable list ever needs it.
//
// Deliberately doesn't move the element in the DOM live, for two reasons.
// First, a CSS Grid container (several items per row, not a single
// column) would change which column a neighbor falls into mid-drag,
// changing its measured position, which can immediately reverse the very
// decision that just moved it — an oscillation instead of a settled
// drop. Second, moving the dragged element's own subtree — which
// contains the handle that has pointer capture — mid-gesture silently
// drops that capture in Chromium, ending the drag after a single move
// event.

interface WireDragHandleOpts {
  /** the element that starts the drag on pointerdown */
  handle: HTMLElement;
  /** the sibling element that actually moves */
  item: HTMLElement;
  /** the shared parent whose children are reordered */
  container: HTMLElement;
  /** selector (within `container`) matching every reorderable sibling, including `item` */
  itemSelector: string;
  /** class applied to `item` for the duration of the drag */
  draggingClass: string;
  /** class applied to whichever sibling is currently the drop target */
  dropTargetClass: string;
  /** called once, only if the drop actually changed `item`'s index */
  onDrop: (item: HTMLElement, endIndex: number) => void;
}

export function wireDragHandle({
  handle,
  item,
  container,
  itemSelector,
  draggingClass,
  dropTargetClass,
  onDrop,
}: WireDragHandleOpts): void {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const itemsNow = () => [...container.querySelectorAll<HTMLElement>(itemSelector)];
    const startIndex = itemsNow().indexOf(item);
    item.classList.add(draggingClass);

    // Snapshot once, not re-measured per move — see the module doc comment.
    const others = itemsNow()
      .filter((el) => el !== item)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, rect, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
      });

    let dropTarget: { el: Element; before: boolean } | null = null;

    const onMove = (moveEvent: PointerEvent) => {
      const { clientX: x, clientY: y } = moveEvent;
      let closest: (typeof others)[number] | null = null;
      let closestDist = Infinity;
      for (const candidate of others) {
        const dist = (x - candidate.cx) ** 2 + (y - candidate.cy) ** 2;
        if (dist < closestDist) {
          closestDist = dist;
          closest = candidate;
        }
      }
      if (!closest) return;
      const { el, rect, cx, cy } = closest;
      const sameRow = y >= rect.top && y <= rect.bottom;
      const before = sameRow ? x < cx : y < cy;
      for (const other of others) other.el.classList.remove(dropTargetClass);
      el.classList.add(dropTargetClass);
      dropTarget = { el, before };
    };
    const onEnd = () => {
      item.classList.remove(draggingClass);
      for (const other of others) other.el.classList.remove(dropTargetClass);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      if (dropTarget) {
        container.insertBefore(item, dropTarget.before ? dropTarget.el : dropTarget.el.nextSibling);
      }
      const endIndex = itemsNow().indexOf(item);
      if (endIndex !== startIndex) onDrop(item, endIndex);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });
}
