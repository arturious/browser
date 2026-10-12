/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * ZenHapticFeedback's native alignment pulse is adapted below. */
// Puts macOS's Liquid Glass (NSGlassEffectView, macOS 26+) behind an
// Electron window's content. Electron itself only offers the older
// NSVisualEffectView blur (`vibrancy`).
#include <node_api.h>
#import <AppKit/AppKit.h>

static NSString *const kGlassIdentifier = @"browser-liquid-glass";

static napi_value JSBool(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

// Reads the (handle: Buffer, cornerRadius: number) arguments both functions
// take. `handle` is BrowserWindow.getNativeWindowHandle() — a pointer to the
// window's content NSView.
static bool ReadArgs(napi_env env, napi_callback_info info, NSView *__unsafe_unretained *root, double *cornerRadius) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) return false;
  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length < sizeof(void *)) return false;
  napi_get_value_double(env, args[1], cornerRadius);
  *root = *(NSView *__unsafe_unretained *)data;
  return *root != nil;
}

// addGlass(handle, cornerRadius): boolean — false where Liquid Glass isn't available.
static napi_value AddGlass(napi_env env, napi_callback_info info) {
  NSView *__unsafe_unretained root = nil;
  double cornerRadius = 0;
  if (!ReadArgs(env, info, &root, &cornerRadius)) return JSBool(env, false);
  if (@available(macOS 26.0, *)) {
    NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:root.bounds];
    glass.identifier = kGlassIdentifier;
    glass.style = NSGlassEffectViewStyleRegular;
    glass.cornerRadius = cornerRadius;
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // Behind everything Electron draws.
    [root addSubview:glass positioned:NSWindowBelow relativeTo:nil];
    return JSBool(env, true);
  }
  return JSBool(env, false);
}

// setGlassCornerRadius(handle, cornerRadius) — 0 in fullscreen, where the
// glass also reaches a little past the window's edges: it draws a bright
// highlight along its own edge, which there would otherwise run along the
// screen's edges. (In a normal window the corners have to stay rounded, so
// the glass stays the window's size.)
static napi_value SetGlassCornerRadius(napi_env env, napi_callback_info info) {
  NSView *__unsafe_unretained root = nil;
  double cornerRadius = 0;
  if (!ReadArgs(env, info, &root, &cornerRadius)) return JSBool(env, false);
  if (@available(macOS 26.0, *)) {
    for (NSView *view in root.subviews) {
      if ([view.identifier isEqualToString:kGlassIdentifier]) {
        const CGFloat bleed = cornerRadius == 0 ? 8 : 0;
        view.frame = NSInsetRect(root.bounds, -bleed, -bleed);
        ((NSGlassEffectView *)view).cornerRadius = cornerRadius;
        return JSBool(env, true);
      }
    }
  }
  return JSBool(env, false);
}

// Chromium's DOM WheelEvent omits NSEvent phase/momentumPhase. Forward only
// lifecycle signals for our window; the DOM still owns hit testing and deltas.
struct WheelPhase { int phase; bool momentum; };
struct WheelMonitor { id token; napi_threadsafe_function callback; bool closed = false; };

static void DispatchWheelPhase(napi_env env, napi_value callback, void *, void *data) {
  WheelPhase *phase = static_cast<WheelPhase *>(data);
  if (env && callback) {
    napi_value event, value, receiver;
    napi_create_object(env, &event);
    const char *name = phase->phase == 1 ? "began" : phase->phase == 2 ? "ended" : phase->phase == 3 ? "cancelled" : phase->phase == 4 ? "changed" : "none";
    napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, event, "phase", value);
    napi_get_boolean(env, phase->momentum, &value);
    napi_set_named_property(env, event, "momentum", value);
    napi_get_undefined(env, &receiver);
    napi_call_function(env, receiver, callback, 1, &event, nullptr);
  }
  delete phase;
}

static void CloseWheelMonitor(WheelMonitor *monitor) {
  if (monitor->closed) return;
  monitor->closed = true;
  [NSEvent removeMonitor:monitor->token];
  monitor->token = nil;
  napi_release_threadsafe_function(monitor->callback, napi_tsfn_abort);
}

static void CleanupWheelMonitor(void *data) {
  auto *monitor = static_cast<WheelMonitor *>(data);
  CloseWheelMonitor(monitor);
  delete monitor;
}

static napi_value StopWheelMonitor(napi_env env, napi_callback_info info) {
  void *data;
  napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data);
  CloseWheelMonitor(static_cast<WheelMonitor *>(data));
  napi_value result; napi_get_undefined(env, &result); return result;
}

static napi_value WatchWheelPhases(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void *data = nullptr; size_t length = 0;
  if (argc < 2 || napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length < sizeof(void *)) return JSBool(env, false);
  NSView *root = *(NSView *__unsafe_unretained *)data;
  __weak NSWindow *window = root.window;
  auto *monitor = new WheelMonitor();
  napi_value resource;
  napi_create_string_utf8(env, "SidebarWheelPhases", NAPI_AUTO_LENGTH, &resource);
  if (napi_create_threadsafe_function(env, args[1], nullptr, resource, 0, 1, nullptr, nullptr, nullptr, DispatchWheelPhase, &monitor->callback) != napi_ok) {
    delete monitor; return JSBool(env, false);
  }
  napi_unref_threadsafe_function(env, monitor->callback);
  monitor->token = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    if (!monitor->closed && window && event.window == window) {
      int phase = event.phase & NSEventPhaseBegan ? 1 : event.phase & NSEventPhaseEnded ? 2 : event.phase & NSEventPhaseCancelled ? 3 : event.phase & (NSEventPhaseChanged | NSEventPhaseStationary) ? 4 : 0;
      auto *value = new WheelPhase{phase, event.momentumPhase != NSEventPhaseNone};
      if (napi_call_threadsafe_function(monitor->callback, value, napi_tsfn_nonblocking) != napi_ok) delete value;
    }
    return event;
  }];
  napi_add_env_cleanup_hook(env, CleanupWheelMonitor, monitor);
  napi_value unsubscribe;
  napi_create_function(env, "stopWheelPhases", NAPI_AUTO_LENGTH, StopWheelMonitor, monitor, &unsubscribe);
  return unsubscribe;
}

// MPL-2.0. Same native feedback as ZenHapticFeedback.mm.
static napi_value PlayHapticFeedback(napi_env env, napi_callback_info info) {
  [[NSHapticFeedbackManager defaultPerformer] performFeedbackPattern:NSHapticFeedbackPatternAlignment performanceTime:NSHapticFeedbackPerformanceTimeDefault];
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "addGlass", NAPI_AUTO_LENGTH, AddGlass, nullptr, &fn);
  napi_set_named_property(env, exports, "addGlass", fn);
  napi_create_function(env, "setGlassCornerRadius", NAPI_AUTO_LENGTH, SetGlassCornerRadius, nullptr, &fn);
  napi_set_named_property(env, exports, "setGlassCornerRadius", fn);
  napi_create_function(env, "watchWheelPhases", NAPI_AUTO_LENGTH, WatchWheelPhases, nullptr, &fn);
  napi_set_named_property(env, exports, "watchWheelPhases", fn);
  napi_create_function(env, "playHapticFeedback", NAPI_AUTO_LENGTH, PlayHapticFeedback, nullptr, &fn);
  napi_set_named_property(env, exports, "playHapticFeedback", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
