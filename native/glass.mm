// Puts macOS's Liquid Glass (NSGlassEffectView, macOS 26+) behind an
// Electron window's content. Electron itself only offers the older
// NSVisualEffectView blur (`vibrancy`).
#include <node_api.h>
#import <AppKit/AppKit.h>

static napi_value JSBool(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

// addGlass(handle: Buffer, cornerRadius: number): boolean
// `handle` is BrowserWindow.getNativeWindowHandle() — a pointer to the
// window's content NSView. Returns false where Liquid Glass isn't available.
static napi_value AddGlass(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) return JSBool(env, false);

  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length < sizeof(void *)) {
    return JSBool(env, false);
  }
  double cornerRadius = 0;
  napi_get_value_double(env, args[1], &cornerRadius);

  if (@available(macOS 26.0, *)) {
    NSView *root = *(NSView *__unsafe_unretained *)data;
    if (!root) return JSBool(env, false);
    NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:root.bounds];
    glass.style = NSGlassEffectViewStyleRegular;
    glass.cornerRadius = cornerRadius;
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // Behind everything Electron draws.
    [root addSubview:glass positioned:NSWindowBelow relativeTo:nil];
    return JSBool(env, true);
  }
  return JSBool(env, false);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "addGlass", NAPI_AUTO_LENGTH, AddGlass, nullptr, &fn);
  napi_set_named_property(env, exports, "addGlass", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
