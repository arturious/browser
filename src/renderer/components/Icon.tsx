import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleArrowDown,
  CircleCheck,
  CircleX,
  History,
  Inbox,
  Link,
  PanelLeft,
  PictureInPicture2,
  Pin,
  Plus,
  RotateCw,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../state';

/** Lucide stand-ins, used only if macOS doesn't provide an SF Symbol. */
const FALLBACKS: Record<string, LucideIcon> = {
  'arrow.backward': ArrowLeft,
  'arrow.forward': ArrowRight,
  'arrow.clockwise': RotateCw,
  xmark: X,
  plus: Plus,
  'sidebar.left': PanelLeft,
  pin: Pin,
  pip: PictureInPicture2,
  'speaker.wave.2': Volume2,
  link: Link,
  checkmark: Check,
  macwindow: AppWindow,
  tray: Inbox,
  'clock.arrow.trianglehead.counterclockwise.rotate.90': History,
  'xmark.circle': CircleX,
  'checkmark.circle': CircleCheck,
  'arrow.down.circle': CircleArrowDown,
};

interface IconProps {
  name: string;
  /** Like SwiftUI's `.font(.system(size:))`. */
  size: number;
  bold?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** An SF Symbol, tinted with the current text color. */
export function Icon({ name, size, bold, className = '', style }: IconProps) {
  const symbol = api.symbols[`${name}:${bold ? 'bold' : 'regular'}`];
  if (!symbol) {
    const Fallback = FALLBACKS[name] ?? X;
    return (
      <Fallback
        className={`icon ${className}`}
        size={size * 1.1}
        strokeWidth={bold ? 2.4 : 1.8}
        style={style}
      />
    );
  }
  // Rendered large; scaled to the size SwiftUI's .font(.system(size:)) would draw.
  const scale = size / symbol.pointSize;
  return (
    <span
      className={`icon symbol ${className}`}
      style={{
        width: symbol.width * scale,
        height: symbol.height * scale,
        WebkitMaskImage: `url(${symbol.url})`,
        ...style,
      }}
    />
  );
}

interface Layer {
  key: number;
  name: string;
  phase: 'idle' | 'entering' | 'leaving';
}

interface SymbolTransitionProps extends Omit<IconProps, 'name'> {
  name: string;
  /**
   * SwiftUI's `.contentTransition(.symbolEffect(.replace…))`: `downUp`
   * shrinks the old symbol away while the new one grows in; `offUp` drops
   * the old one at once and grows the new one in.
   */
  effect?: 'downUp' | 'offUp';
}

/** A symbol that animates whenever `name` changes (but not when it first appears). */
export function SymbolTransition({ name, effect = 'downUp', className = '', ...icon }: SymbolTransitionProps) {
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, name, phase: 'idle' }]);
  const shown = useRef(name);
  const nextKey = useRef(1);

  useLayoutEffect(() => {
    if (shown.current === name) return;
    shown.current = name;
    const entering: Layer = { key: nextKey.current++, name, phase: 'entering' };
    setLayers((current) =>
      effect === 'downUp'
        ? [...current.filter((l) => l.phase !== 'leaving').map((l) => ({ ...l, phase: 'leaving' as const })), entering]
        : [entering],
    );
  }, [name, effect]);

  const settle = (layer: Layer) =>
    setLayers((current) =>
      layer.phase === 'leaving'
        ? current.filter((l) => l.key !== layer.key)
        : current.map((l) => (l.key === layer.key ? { ...l, phase: 'idle' } : l)),
    );

  return (
    <span className={`symbol-stack ${className}`}>
      {layers.map((layer) => (
        <span
          key={layer.key}
          className={`symbol-layer ${layer.phase} ${effect}`}
          onAnimationEnd={(e) => e.target === e.currentTarget && settle(layer)}
        >
          <Icon name={layer.name} {...icon} />
        </span>
      ))}
    </span>
  );
}
