/* MPL-2.0. Generated from ZenFolders.#animateItem, with a shared animation registry. */
const folderAnimations = new WeakMap();
export function cancelFolderRow(item) { folderAnimations.get(item)?.cancel(); folderAnimations.delete(item); }
export async function animateFolderRow(item, targetState, { duration = 0.18, ease } = {}) {
    const computed = window.getComputedStyle(item);
    const toCssValue = (prop, value) =>
      typeof value === "number" && prop !== "opacity"
        ? `${value}px`
        : String(value);
    const measure = prop => {
      const value = computed[prop];
      if (value === "auto") {
        return `${item.getBoundingClientRect()[prop] ?? 0}px`;
      }
      return value;
    };
    const from = {};
    const to = {};
    const finalStyles = new Map();
    for (const [prop, value] of Object.entries(targetState)) {
      const start = Array.isArray(value) ? value[0] : undefined;
      from[prop] =
        start === undefined || start === "auto"
          ? measure(prop)
          : toCssValue(prop, start);
    }
    // The start values are taken, the natural values need to be measured
    // without the previous animation applying.
    folderAnimations.get(item)?.cancel();
    for (const [prop, value] of Object.entries(targetState)) {
      let end = Array.isArray(value) ? value[1] : value;
      const cssProp = prop.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
      if (end === "" || end === "auto") {
        // Resolve the natural value by clearing any inline override.
        item.style.removeProperty(cssProp);
        end = measure(prop);
        finalStyles.set(cssProp, null);
      } else {
        end = toCssValue(prop, end);
        finalStyles.set(cssProp, end);
      }
      to[prop] = end;
    }
    const animation = item.animate([from, to], {
      duration: duration * 1000,
      easing: ease === "easeInOut" ? "ease-in-out" : "ease",
    });
    folderAnimations.set(item, animation);
    try {
      await animation.finished;
    } catch (e) {
      // The animation was replaced, leave the element to the new one.
      return false;
    }
    for (const [cssProp, value] of finalStyles) {
      if (value === null) {
        item.style.removeProperty(cssProp);
      } else {
        item.style.setProperty(cssProp, value);
      }
    }
    return true;
  }
