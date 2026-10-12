import type { ThemeDot } from '../../shared/types';
export class ZenThemeColors {
  constructor(dark?: boolean, opacity?: number);
  useAlgo: string;
  dots: { ID: number; position: { x: number; y: number }; type?: string }[];
  colorHarmonies: { type: string; angles: number[] }[];
  getGradient(colors: ThemeDot[], forToolbar?: boolean): string;
  getColorFromPosition(x: number, y: number, type?: string): [number, number, number];
  hexToRgb(hex: string): [number, number, number];
  calculateCompliments(dots: typeof this.dots, action?: string, harmony?: string): typeof this.dots;
}
