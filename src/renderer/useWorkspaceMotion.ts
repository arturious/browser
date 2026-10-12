/* MPL-2.0. Adapted from ZenSpaceManager._organizeWorkspaceStripLocations
 * and #animateTabs; original Motion runtime from the user's Zen checkout. */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate, type AnimationControls } from '../vendor/zen-motion.cjs';
import type { AppState } from '../shared/types';
import type { SidebarGesture } from './useSidebarGestures';

export function workspaceSlot(index: number, active: number, count: number) {
  let difference = index - active;
  if (difference > Math.floor(count / 2)) difference -= count;
  else if (difference < -Math.floor(count / 2)) difference += count;
  return difference;
}

export function useWorkspaceMotion(root: RefObject<HTMLElement | null>, state: AppState, gesture: SidebarGesture) {
  const initialized = useRef(false);
  const controls = useRef<AnimationControls[]>([]);
  const order = state.workspaces.map(workspace => workspace.id).join(',');
  const active = state.workspaces.findIndex(workspace => workspace.id === state.activeWorkspaceId);
  useLayoutEffect(() => {
    if (!root.current) return;
    controls.current.forEach(control => control.stop()); controls.current = [];
    const panels = root.current.querySelectorAll<HTMLElement>('.space-panel');
    const width = root.current.clientWidth || 240;
    const extra = gesture.addProgress > 0 ? -12.5 * gesture.addProgress : gesture.offset / width * 100;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panels.forEach((panel, index) => {
      const offset = workspaceSlot(index, active, panels.length) * 100 + extra;
      const target = `translateX(${offset}%)`;
      if (!initialized.current || gesture.active || reduced || !panel.style.transform || Math.abs(offset) > 100) panel.style.transform = target;
      else if (panel.style.transform !== target) controls.current.push(animate(panel, { transform: [panel.style.transform, target] }, { type: 'spring', bounce: 0, duration: 0.25 }));
    });
    initialized.current = true;
    // Zen blends the adjacent workspace background by gesture distance.
    const adjacent = state.workspaces[active + (gesture.offset < 0 ? 1 : -1)];
    root.current.style.setProperty('--workspace-next-color', adjacent?.color ?? state.workspaces[active]?.color ?? '#9c88ff');
    root.current.style.setProperty('--workspace-crossfade', `${gesture.active && !gesture.addProgress ? Math.min(Math.abs(gesture.offset) / width, 1) : 0}`);
    return () => { controls.current.forEach(control => control.stop()); controls.current = []; };
  }, [root, active, order, gesture.offset, gesture.active, gesture.addProgress]);
}
