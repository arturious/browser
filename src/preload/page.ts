// A small helper inside every web page, walled off from the page in its own
// isolated world: it reports media playback, Picture in Picture ending, and
// two-finger swipes back/forward to the main process.
import { contextBridge, ipcRenderer } from 'electron';

// MARK: Media playback

// Event listeners catch play/pause instantly; the poll is only a safety net
// for players that don't fire them reliably, so it's tight only while
// something is actually playing.
(() => {
  let lastVideo = false;
  let lastMedia = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isPlaying = (el: HTMLMediaElement) => !el.paused && !el.ended;

  function report() {
    clearTimeout(timer);
    const video = Array.from(document.querySelectorAll('video')).some(isPlaying);
    const media = video || Array.from(document.querySelectorAll('audio')).some(isPlaying);
    if (video !== lastVideo || media !== lastMedia) {
      lastVideo = video;
      lastMedia = media;
      ipcRenderer.send('page:media', { video, media });
    }
    timer = setTimeout(report, media ? 1000 : 4000);
  }
  for (const type of ['play', 'pause', 'ended']) document.addEventListener(type, report, true);
  timer = setTimeout(report, 1000);
})();

// MARK: Picture in Picture

// Closing the PiP window pauses the video; a video that was playing should
// keep playing in the page, but one the person had paused stays paused.
(() => {
  let isPlaying = false;
  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLVideoElement) isPlaying = true;
  }, true);
  document.addEventListener('pause', (e) => {
    if (e.target instanceof HTMLVideoElement) isPlaying = false;
  }, true);
  document.addEventListener('leavepictureinpicture', (e) => {
    const video = e.target as HTMLVideoElement;
    const wasPlaying = isPlaying;
    setTimeout(() => {
      if (wasPlaying && video.paused) video.play().catch(() => {});
      ipcRenderer.send('page:pip-exited');
    }, 200);
  }, true);
})();

// MARK: Swipe back / forward

// Horizontal two-finger swipes show our own arrow at the page's edge and,
// pulled far enough, go back or forward — unless something on the page
// could scroll sideways in that direction.
(() => {
  const THRESHOLD = 150;
  let canGoBack = false;
  let canGoForward = false;
  ipcRenderer.on('page:nav-state', (_e, state: { canGoBack: boolean; canGoForward: boolean }) => {
    canGoBack = state.canGoBack;
    canGoForward = state.canGoForward;
  });

  let tracking: boolean | null = null;
  let accumulated = 0;
  let committed = false;
  let decaying = 0;
  let lastMagnitude = 0;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  const allowed = (isBack: boolean) => (isBack ? canGoBack : canGoForward);

  function canScrollSideways(target: EventTarget | null, deltaX: number): boolean {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth) continue;
      const overflow = getComputedStyle(el).overflowX;
      const scrollable = overflow === 'auto' || overflow === 'scroll' || el === document.scrollingElement;
      if (!scrollable) continue;
      if (deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }
    return false;
  }

  function finish() {
    const isBack = accumulated > 0;
    if (tracking && !committed && Math.abs(accumulated) >= THRESHOLD && allowed(isBack)) commit(isBack);
    tracking = null;
    accumulated = 0;
    committed = false;
    decaying = 0;
    indicator.show(0, isBack);
  }

  function commit(isBack: boolean) {
    committed = true;
    ipcRenderer.send('page:swipe', isBack);
    indicator.show(0, isBack);
  }

  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // pinch
    clearTimeout(endTimer);
    endTimer = setTimeout(finish, 120);
    if (tracking === null) {
      tracking = Math.abs(e.deltaX) > Math.abs(e.deltaY) && !canScrollSideways(e.target, e.deltaX);
      accumulated = 0;
      lastMagnitude = 0;
    }
    if (!tracking || committed) return;

    // Fingers moving right scroll content left (negative deltaX): back.
    accumulated -= e.deltaX;
    const isBack = accumulated > 0;
    if (!allowed(isBack)) return;
    const progress = Math.min(Math.abs(accumulated) / THRESHOLD, 1);
    indicator.show(progress, isBack);

    // Once the fingers lift, macOS keeps sending shrinking "momentum"
    // deltas; a few in a row past the threshold count as letting go.
    const magnitude = Math.abs(e.deltaX);
    decaying = magnitude < lastMagnitude ? decaying + 1 : 0;
    lastMagnitude = magnitude;
    if (progress >= 1 && decaying >= 3) commit(isBack);
  }, { passive: true });

  // Drawn inside the page (in a closed shadow root the page can't touch),
  // since the page's view sits above the browser's own interface.
  const indicator = (() => {
    let host: HTMLElement | null = null;
    let strip: HTMLElement;
    let arrow: HTMLElement;
    function build() {
      host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .strip { position: fixed; top: 0; bottom: 0; width: 100px; z-index: 2147483647; pointer-events: none;
                   display: flex; align-items: center; transition: opacity .12s ease-out; }
          .arrow { width: 14px; height: 24px; margin: 0 16px; transition: transform .12s ease-out; }
        </style>
        <div class="strip"><svg class="arrow" viewBox="0 0 14 24" fill="none" stroke="white" stroke-width="3"
          stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 12l10 10"/></svg></div>`;
      strip = root.querySelector('.strip')!;
      arrow = root.querySelector('.arrow')!;
      document.documentElement.appendChild(host);
    }
    return {
      show(progress: number, isBack: boolean) {
        if (!host) {
          if (progress === 0) return;
          build();
        }
        strip.style.left = isBack ? '0' : '';
        strip.style.right = isBack ? '' : '0';
        strip.style.justifyContent = isBack ? 'flex-start' : 'flex-end';
        strip.style.background = `linear-gradient(to ${isBack ? 'right' : 'left'}, rgba(0,0,0,${0.4 * progress}), transparent)`;
        arrow.style.opacity = String(progress);
        arrow.style.transform = `scale(${0.7 + 0.3 * progress}) ${isBack ? '' : 'scaleX(-1)'}`;
      },
    };
  })();
})();

// MARK: Passkeys on Google sign-in

// Google's sign-in can stall on "Use your passkey to confirm it's really you"
// in an embedded browser; with WebAuthn hidden it falls back to the normal
// password/code flow.
if (location.hostname === 'accounts.google.com') {
  contextBridge.executeInMainWorld({
    func: () => {
      Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
      if (navigator.credentials) {
        navigator.credentials.get = () => Promise.reject(new Error('WebAuthn disabled'));
        navigator.credentials.create = () => Promise.reject(new Error('WebAuthn disabled'));
      }
    },
  });
}
