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

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "addGlass", NAPI_AUTO_LENGTH, AddGlass, nullptr, &fn);
  napi_set_named_property(env, exports, "addGlass", fn);
  napi_create_function(env, "setGlassCornerRadius", NAPI_AUTO_LENGTH, SetGlassCornerRadius, nullptr, &fn);
  napi_set_named_property(env, exports, "setGlassCornerRadius", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
