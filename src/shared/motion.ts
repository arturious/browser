/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Gesture constants and rubber band behavior adapted from Zen Browser
 * ZenLibrary.mjs and ZenSpaceAddSwipe.mjs, version 1.23.2b. */

import { spring } from '../vendor/zen-motion.cjs';

export const LIBRARY_SPRING = { stiffness: 720, damping: 47, mass: 1.2 };
export function createLibrarySpring(initial: number, target: number) {
  return spring({ keyframes: [initial, target], ...LIBRARY_SPRING });
}
export const SWIPE_THRESHOLD = 0.25;
export const ADD_SPACE_THRESHOLD = 0.8;
// Gecko also resists movement in its native swipe tracker. Wheel momentum
// accumulates pixel deltas, so bound the outer-edge stretch in screen pixels.
export const LIBRARY_OVERSCROLL_PX = 12;

/** Wheel events are incremental pixel distances, unlike Gecko's native swipe
 * tracker. Keep their accumulated distance: decaying it between events makes
 * a slowing, one-direction gesture visibly reverse. Resistance is monotonic. */
export function advanceSidebarSwipe(previous: number, delta: number, width: number) {
  const carry = previous + delta;
  return { translation: rubberBand(carry, width * 4.5, 1), carry };
}

export function rubberBand(offset: number, dimension = 0.2, constant = 0.08): number {
  return dimension * (1 - Math.exp(-Math.abs(offset) * constant / dimension)) * Math.sign(offset);
}

export function dampProgress(progress: number, dimension = 0.2): number {
  if (progress < 0) return rubberBand(progress, dimension);
  if (progress > 1) return 1 + rubberBand(progress - 1, dimension);
  return progress;
}

/** Keep the first frame continuous even when a swipe interrupts spring
 * overshoot: the visible starting position has already been rubber-banded. */
export function librarySwipeProgress(initial: number, translation: number, width: number, libraryWidth = 418): number {
  if (translation === 0) return initial;
  const overshoot = Math.max(-initial, initial - 1, 0);
  // Keep an interrupted spring continuous even if it is already past the
  // wheel stretch limit. A settled Library always uses the 12px envelope.
  const dimension = Math.max(LIBRARY_OVERSCROLL_PX / libraryWidth, overshoot * 1.5);
  const unband = (offset: number) => -dimension / 0.08 * Math.log1p(-Math.abs(offset) / dimension) * Math.sign(offset);
  const rawInitial = initial < 0 ? unband(initial) : initial > 1 ? 1 + unband(initial - 1) : initial;
  return dampProgress(rawInitial + translation / width * 0.8, dimension);
}

/** Zen's library resizing curve: cubic-bezier(.36,.06,0,.94). */
export function libraryResizeEase(progress: number): number {
  const x = Math.min(Math.max(progress, 0), 1);
  let low = 0, high = 1;
  for (let i = 0; i < 18; i++) {
    const t = (low + high) / 2;
    const bezierX = 3 * (1 - t) ** 2 * t * 0.36 + t ** 3;
    if (bezierX < x) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) ** 2 * t * 0.06 + 3 * (1 - t) * t ** 2 * 0.94 + t ** 3;
}

export type SwipeAction = 'library' | 'space' | 'add';

export function swipeAction(initialLibraryOpen: boolean, index: number, count: number, translation: number): SwipeAction {
  if (initialLibraryOpen || index === 0 && translation > 0) return 'library';
  if (index === count - 1 && translation < 0) return 'add';
  return 'space';
}

export function librarySwipeTarget(initialOpen: boolean, distance: number, velocity: number, cancelled = false): boolean {
  const success = !cancelled && (Math.abs(distance) >= SWIPE_THRESHOLD || Math.abs(velocity) > 0.5 && Math.abs(distance) > 0.06);
  return success ? distance > 0 : initialOpen;
}
