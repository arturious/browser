import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState, TabState } from '../../shared/types';
import { displayHost } from '../../shared/url';
import { api, rectOf } from '../state';
import { Icon, SymbolTransition } from './Icon';

const PLACEHOLDER = 'Search or enter address.';

interface ToolbarButtonProps {
  icon: ReactNode;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLDivElement>;
  children?: ReactNode;
}

export function ToolbarButton({ icon, disabled, className = '', onClick, buttonRef, children }: ToolbarButtonProps) {
  return (
    <div
      ref={buttonRef}
      className={`toolbar-button ${disabled ? 'disabled' : ''} ${className}`}
      onClick={() => !disabled && onClick()}
    >
      {icon}
      {children}
    </div>
  );
}

/** Back, forward, and reload — which wiggles, then turns into stop if loading drags on. */
export function NavigationControls({ tab }: { tab: TabState }) {
  const [showStop, setShowStop] = useState(false);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (!tab.isLoading) {
      setShowStop(false);
      setSpinning(false);
      return;
    }
    setShowStop(false);
    setSpinning(true);
    const timer = setTimeout(() => {
      setSpinning(false);
      setShowStop(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [tab.isLoading, tab.id]);

  return (
    <>
      <ToolbarButton
        icon={<Icon name="arrow.backward" size={14} bold />}
        disabled={!tab.canGoBack}
        onClick={api.goBack}
      />
      <ToolbarButton
        icon={<Icon name="arrow.forward" size={14} bold />}
        disabled={!tab.canGoForward}
        onClick={api.goForward}
      />
      <ToolbarButton
        icon={
          <SymbolTransition
            name={showStop ? 'xmark' : 'arrow.clockwise'}
            effect="offUp"
            size={14}
            bold
            className={spinning ? 'wiggle-loop' : ''}
          />
        }
        onClick={() => (tab.isLoading ? api.stop() : api.reload())}
      />
    </>
  );
}

export function NewTabIndicator() {
  return (
    <div className="new-tab-indicator">
      <Icon name="macwindow" size={12} bold />
      <span>New Tab</span>
    </div>
  );
}

/** Copies the page's address; the link turns into a checkmark for a moment. */
export function LinkCopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <ToolbarButton
      className="small light"
      icon={<SymbolTransition name={copied ? 'checkmark' : 'link'} size={12} bold />}
      onClick={() => {
        api.copyText(url);
        setCopied(true);
      }}
    />
  );
}

/** Always takes its space, so the address doesn't shift as videos start and stop. */
export function PiPButton({ visible }: { visible: boolean }) {
  return (
    <ToolbarButton
      className={`small light ${visible ? '' : 'invisible'}`}
      icon={<Icon name="pip" size={12} bold />}
      onClick={api.togglePiP}
    />
  );
}

let measureContext: CanvasRenderingContext2D | null = null;
/** The field grows to fit what's typed, up to 600px. */
function measuredWidth(text: string): number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return 200;
  measureContext.font = '500 13px -apple-system, BlinkMacSystemFont, sans-serif';
  return Math.min(Math.max(measureContext.measureText(text).width + 2, 1), 600);
}

interface AddressFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBlur: () => void;
}

/** Focuses itself (with everything selected) as it appears. */
export function AddressField({ value, onChange, onSubmit, onBlur }: AddressFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="address-input"
      value={value}
      placeholder={PLACEHOLDER}
      spellCheck={false}
      style={{ width: measuredWidth(value || PLACEHOLDER) }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onMouseDown={(e) => {
        // Clicking into an empty field that's already focused dismisses it.
        if (!value && document.activeElement === e.currentTarget) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

interface AddressBarProps {
  activeTab: TabState | undefined;
}

/**
 * The centered address: the site's host while reading, the full URL while
 * editing, or an empty field with "New Tab" beside it after Cmd+T.
 */
export function AddressBar({ activeTab }: AddressBarProps) {
  const [input, setInput] = useState(activeTab?.url ?? '');
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const editingRef = useRef(false);
  editingRef.current = editing || creating;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    const startNewTab = () => {
      setInput('');
      setCreating(true);
      setEditing(true);
    };
    // Cmd+T comes from the menu; the sidebar's "+" from within the page.
    window.addEventListener('browser:new-tab', startNewTab);
    const unsubscribe = api.onCommand((command) => {
      if (command === 'new-tab') {
        startNewTab();
      } else if (command === 'focus-address' && activeTabRef.current) {
        setInput(activeTabRef.current.url);
        setEditing(true);
      }
    });
    return () => {
      window.removeEventListener('browser:new-tab', startNewTab);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!editingRef.current) setInput(activeTab?.url ?? '');
  }, [activeTab?.url, activeTab?.id]);

  const finishEditing = () => {
    setEditing(false);
    setCreating(false);
    setInput(activeTab?.url ?? '');
  };

  const submit = () => {
    const value = input.trim();
    if (value) {
      api.navigate(value, creating);
      if (!creating) api.focusPage();
    }
    setEditing(false);
    setCreating(false);
  };

  if (!activeTab && !creating) return null;

  const field = (
    <AddressField value={input} onChange={setInput} onSubmit={submit} onBlur={finishEditing} />
  );

  return (
    <div className="address-bar">
      {creating ? <NewTabIndicator /> : activeTab && <LinkCopyButton url={activeTab.url} />}
      <div
        className="address-display"
        onClick={() => {
          if (editing || !activeTab) return;
          setInput(activeTab.url);
          setEditing(true);
        }}
      >
        {editing || !activeTab ? field : <span className="address-host">{displayHost(activeTab.url)}</span>}
      </div>
      {activeTab && <PiPButton visible={activeTab.hasPlayingVideo} />}
    </div>
  );
}

export function HistoryButton({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [wiggle, setWiggle] = useState(0);
  return (
    <ToolbarButton
      buttonRef={ref}
      icon={
        <Icon
          key={wiggle}
          name="clock.arrow.trianglehead.counterclockwise.rotate.90"
          size={14}
          bold
          className={wiggle ? 'wiggle-once' : ''}
        />
      }
      onClick={() => {
        setWiggle((n) => n + 1);
        api.setPopover(open ? null : 'history', rectOf(ref.current!));
      }}
    />
  );
}

/** The tray, which turns into a pie of the overall progress while files download. */
export function DownloadsButton({ state, buttonRef }: { state: AppState; buttonRef: React.RefObject<HTMLDivElement | null> }) {
  const active = state.downloads.filter((d) => !d.isFinished);
  const isActive = active.length > 0;
  const progress = isActive ? active.reduce((sum, d) => sum + d.progress, 0) / active.length : 0;
  const open = state.ui.popover === 'downloads';

  return (
    <ToolbarButton
      buttonRef={buttonRef}
      className="downloads-button"
      icon={
        <>
          <Icon name="tray" size={14} bold className={`swap ${isActive ? 'out' : ''}`} />
          <svg className={`progress-pie swap ${isActive ? '' : 'out'}`} viewBox="0 0 16 16" width="16" height="16">
            <circle cx="8" cy="8" r="7.25" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
            <path d={piePath(progress)} fill="currentColor" />
          </svg>
        </>
      }
      onClick={() => api.setPopover(open ? null : 'downloads', rectOf(buttonRef.current!))}
    >
      <span className={`unseen-dot ${state.hasUnseenFinishedDownloads && !isActive ? 'visible' : ''}`} />
    </ToolbarButton>
  );
}

function piePath(progress: number): string {
  if (progress <= 0) return '';
  if (progress >= 1) return 'M8 0 A8 8 0 1 1 7.999 0 Z';
  const angle = progress * 2 * Math.PI - Math.PI / 2;
  const x = 8 + 8 * Math.cos(angle);
  const y = 8 + 8 * Math.sin(angle);
  return `M8 8 L8 0 A8 8 0 ${progress > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}
