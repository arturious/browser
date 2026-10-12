import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AppState } from '../shared/types';
import { ADD_SPACE_THRESHOLD, advanceSidebarSwipe, dampProgress, librarySwipeProgress, SWIPE_THRESHOLD, swipeAction, librarySwipeTarget } from '../shared/motion';
import { api } from './state';

export interface SidebarGesture {
  offset: number;
  addProgress: number;
  active: boolean;
}

/** Wheel gestures remain confined to browser chrome; page history swipes
 * continue to belong to the page preload. Mirrors Zen's three edge actions. */
export function useSidebarGestures(element: RefObject<HTMLElement | null>, state: AppState, onCreate?: () => void, enabled = true) {
  const latest = useRef(state);
  latest.current = state;
  const create = useRef(onCreate);
  create.current = onCreate;
  const [gesture, setGesture] = useState<SidebarGesture>({ offset: 0, addProgress: 0, active: false });

  useEffect(() => {
    const target = element.current;
    if (!target || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    let tracking = false;
    let total = 0;
    let action: ReturnType<typeof swipeAction> | null = null;
    let initial = 0;
    let initialOpen = false;
    let carry = 0;
    let index = 0;
    let width = 240;
    let libraryWidth = 418;
    let velocity = 0;
    let lastTime = 0;
    let pointerX: number | null = null;
    let frame = 0;
    let pendingProgress = 0;
    let pendingGesture: SidebarGesture | null = null;
    let nativeWheelActive = false;
    let ignoreMomentum = false;
    let addReady = false;

    const sendProgress = () => {
      frame = 0;
      if (action === 'library') api.setLibraryGesture(pendingProgress);
      else if (pendingGesture) { setGesture(pendingGesture); pendingGesture = null; }
    };
    const reset = () => {
      tracking = false;
      total = 0;
      action = null;
      pendingGesture = null;
      velocity = 0;
      addReady = false;
      setGesture({ offset: 0, addProgress: 0, active: false });
    };
    const finish = (cancelled = false) => {
      clearTimeout(timer);
      if (!tracking) return;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      const current = latest.current;
      const distance = total / width;
      if (action === 'library') {
        api.setLibraryGesture(pendingProgress, librarySwipeTarget(initialOpen, distance, velocity, cancelled));
        reset();
      } else if (action === 'add') {
        if (!cancelled && -distance >= ADD_SPACE_THRESHOLD) {
          create.current?.();
        }
        reset();
      } else if (action === 'space' && !cancelled && Math.abs(distance) >= SWIPE_THRESHOLD) {
        const next = current.workspaces[index + (total < 0 ? 1 : -1)];
        if (next) api.selectWorkspace(next.id);
        reset();
      } else {
        setGesture({ offset: 0, addProgress: 0, active: false });
        clearTimer = setTimeout(reset, 300);
        tracking = false;
      }
    };
    const move = (delta: number, time: number) => {
      if (!tracking) {
        clearTimeout(clearTimer);
        tracking = true;
        const current = api.getState();
        initialOpen = current.ui.libraryOpen;
        initial = current.ui.libraryProgress;
        index = current.workspaces.findIndex((workspace) => workspace.id === current.activeWorkspaceId);
        width = current.appearance.sidebarExpanded ? current.appearance.sidebarWidth : 56;
        // Main owns the Library's width. Compact Peek has its own narrow
        // viewport, which must not amplify this gesture's overscroll.
        libraryWidth = Math.max(418, current.ui.libraryWidth);
        total = 0;
        carry = 0;
        action = null;
        lastTime = time;
      }
      velocity = delta / Math.max(time - lastTime, 8);
      lastTime = time;
      total += delta;
      const resisted = advanceSidebarSwipe(carry, delta, width);
      carry = resisted.carry;
      if (!action && Math.abs(total) >= 7) {
        action = swipeAction(initialOpen || Math.abs(initial) > 0.001, index, latest.current.workspaces.length, total);
      }
      if (action === 'library') {
        pendingProgress = librarySwipeProgress(initial, resisted.translation, width, libraryWidth);
        if (!frame) frame = requestAnimationFrame(sendProgress);
      } else if (action === 'add') {
        const progress = dampProgress(-total / width / 0.8);
        if ((progress >= 1) !== addReady) { addReady = progress >= 1; api.playHapticFeedback(); }
        pendingGesture = { offset: -25 * progress, addProgress: progress, active: true };
        if (!frame) frame = requestAnimationFrame(sendProgress);
      } else if (action === 'space') {
        pendingGesture = { offset: resisted.translation, addProgress: 0, active: true };
        if (!frame) frame = requestAnimationFrame(sendProgress);
      }
      clearTimeout(timer);
      if (pointerX === null && !nativeWheelActive) timer = setTimeout(() => finish(), 120);
    };
    const wheel = (event: WheelEvent) => {
      if (ignoreMomentum) return;
      if (event.ctrlKey || event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], .space-dialog, .library-spaces')) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      move(-event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1), performance.now());
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      pointerX = event.clientX;
      target.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (pointerX === null) return;
      const delta = event.clientX - pointerX;
      pointerX = event.clientX;
      move(delta, performance.now());
    };
    const up = () => { pointerX = null; finish(); };
    const cancel = () => { pointerX = null; finish(true); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && tracking) finish(true); };
    const stopPhases = api.onSidebarWheelPhase(event => {
      if (pointerX !== null) return;
      if (event.momentum) { nativeWheelActive = false; ignoreMomentum = true; finish(); return; }
      if (event.phase === 'began' || event.phase === 'changed') {
        nativeWheelActive = true; ignoreMomentum = false; clearTimeout(timer);
      } else if (event.phase === 'ended' || event.phase === 'cancelled') {
        nativeWheelActive = false; ignoreMomentum = true;
        finish(event.phase === 'cancelled');
      } else { nativeWheelActive = false; ignoreMomentum = false; }
    });
    window.addEventListener('keydown', key, true);
    target.addEventListener('wheel', wheel, { passive: false });
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', pointerMove);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', cancel);
    return () => {
      clearTimeout(timer); clearTimeout(clearTimer); cancelAnimationFrame(frame);
      stopPhases();
      window.removeEventListener('keydown', key, true);
      target.removeEventListener('wheel', wheel);
      target.removeEventListener('pointerdown', down); target.removeEventListener('pointermove', pointerMove);
      target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel);
      if (tracking && action === 'library') api.setLibraryGesture(pendingProgress, initialOpen);
    };
  }, [element, enabled]);
  return gesture;
}
