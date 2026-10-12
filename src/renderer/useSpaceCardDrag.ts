/* MPL-2.0. Adapted from ZenLibrarySpacesSection.mjs pointer drag and
 * auto-scroll; native tab/Gecko calls are replaced by the Electron bridge. */
import { useEffect, type RefObject } from 'react';
import { api } from './state';

export function useSpaceCardDrag(root: RefObject<HTMLElement | null>, enabled: boolean, order: string) {
  useEffect(() => {
    const list = root.current;
    if (!list || !enabled) return;
    let drag: { cards: HTMLElement[]; index: number; drop: number; start: number; x: number; center: number; scroll: number; centers: number[]; handle: HTMLElement; pointer: number } | null = null;
    let frame = 0;
    let landing = 0;
    const clear = () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(landing);
      list.classList.add('no-transition');
      list.querySelectorAll<HTMLElement>('.library-space-card').forEach(card => {
        card.classList.remove('dragging'); card.removeAttribute('shift'); card.style.translate = '';
      });
      landing = requestAnimationFrame(() => { landing = requestAnimationFrame(() => list.classList.remove('no-transition')); });
    };
    const update = () => {
      if (!drag) return;
      const travel = drag.x - drag.start + list.scrollLeft - drag.scroll;
      drag.cards[drag.index].style.translate = `${travel}px 0`;
      drag.drop = drag.centers.filter(center => drag!.center + travel > center).length;
      drag.cards.forEach((card, i) => {
        const shift = drag!.index < i && i <= drag!.drop ? 'left' : drag!.drop <= i && i < drag!.index ? 'right' : '';
        if (shift) card.setAttribute('shift', shift); else card.removeAttribute('shift');
      });
    };
    const scroll = () => {
      if (!drag) return;
      const rect = list.getBoundingClientRect();
      const step = drag.x < rect.left + 48 ? -12 : drag.x > rect.right - 48 ? 12 : 0;
      if (step) { list.scrollLeft += step; update(); }
      frame = requestAnimationFrame(scroll);
    };
    const down = (event: PointerEvent) => {
      const handle = (event.target as Element).closest<HTMLElement>('.library-space-drag');
      if (event.button !== 0 || !handle || drag) return;
      const cards = [...list.querySelectorAll<HTMLElement>('.library-space-card')];
      const card = handle.closest<HTMLElement>('.library-space-card')!;
      const index = cards.indexOf(card);
      const center = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; };
      drag = { cards, index, drop: index, start: event.clientX, x: event.clientX, center: center(card), scroll: list.scrollLeft, centers: cards.filter((_, i) => i !== index).map(center), handle, pointer: event.pointerId };
      card.classList.add('dragging'); handle.setPointerCapture(event.pointerId);
      event.preventDefault(); event.stopPropagation(); scroll();
    };
    const move = (event: PointerEvent) => { if (drag?.pointer === event.pointerId) { drag.x = event.clientX; update(); event.stopPropagation(); } };
    const up = (event: PointerEvent) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const current = drag; drag = null;
      if (current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
      if (event.type === 'pointerup' && current.index !== current.drop) api.reorderWorkspace(current.cards[current.index].dataset.workspaceId!, current.drop);
      clear(); event.stopPropagation();
    };
    list.addEventListener('pointerdown', down);
    list.addEventListener('pointermove', move);
    list.addEventListener('pointerup', up);
    list.addEventListener('pointercancel', up);
    list.addEventListener('lostpointercapture', up);
    return () => {
      if (drag?.handle.hasPointerCapture(drag.pointer)) drag.handle.releasePointerCapture(drag.pointer);
      drag = null; clear();
      list.removeEventListener('pointerdown', down); list.removeEventListener('pointermove', move);
      list.removeEventListener('pointerup', up); list.removeEventListener('pointercancel', up); list.removeEventListener('lostpointercapture', up);
    };
  }, [root, enabled, order]);
}
