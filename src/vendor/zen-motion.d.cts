/** Types for the unmodified Motion distribution bundled in the Zen source. */
export interface SpringOptions {
  keyframes: number[];
  stiffness?: number;
  damping?: number;
  mass?: number;
  duration?: number;
  bounce?: number;
  velocity?: number;
}
export function spring(options: SpringOptions): { next(milliseconds: number): { value: number; done: boolean } };
export interface AnimationControls { stop(): void; then(resolve: () => void): Promise<void> }
export function animate(element: Element | Element[], properties: Record<string, unknown>, options: {
  type?: 'spring'; bounce?: number; duration?: number; ease?: string;
}): AnimationControls;
