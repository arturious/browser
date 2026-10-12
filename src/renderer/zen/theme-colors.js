/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. https://mozilla.org/MPL/2.0/. Generated from the supplied Zen checkout. */
const AppConstants = { platform: 'macosx' };
const lazy = { MIN_OPACITY: .30 };
const EXPLICIT_LIGHTNESS_TYPE = 'explicit-lightness';
const EXPLICIT_BLACKWHITE_TYPE = 'explicit-black-white';
export class ZenThemeColors {
  #currentLightness = 50;
  #allowTransparencyOnSidebar = false;
  isDarkMode = true; isMica = false; canBeTransparent = true; isLegacyVersion = false; currentOpacity = .5; useAlgo = ''; dots = [];
  constructor(dark = true, opacity = .5) { this.isDarkMode = dark; this.currentOpacity = opacity; }
  get colorHarmonies() {
    return [
      { type: "complementary", angles: [180] },
      { type: "singleAnalogous", angles: [310] },
      { type: "splitComplementary", angles: [150, 210] },
      { type: "analogous", angles: [50, 310] },
      { type: "triadic", angles: [120, 240] },
      { type: "floating", angles: [] },
    ];
  }


  hslToRgb(h, s, l) {
    const { round } = Math;
    let r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = this.hueToRgb(p, q, h + 1 / 3);
      g = this.hueToRgb(p, q, h);
      b = this.hueToRgb(p, q, h - 1 / 3);
    }

    return [round(r * 255), round(g * 255), round(b * 255)];
  }

  rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let d = max - min;
    let h;
    if (d === 0) {
      h = 0;
    } else if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else if (max === b) {
      h = (r - g) / d + 4;
    }
    let l = (min + max) / 2;
    let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return [h * 60, s, l];
  }

  hueToRgb(p, q, t) {
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  }

  calculateInitialPosition([r, g, b]) {
    // This function is called before the picker is even rendered, so we hard code the dimensions
    // important: If any sort of sizing is changed, make sure changes are reflected here
    const padding = 0;
    const rect = {
      width: 380 + padding * 2,
      height: 380 + padding * 2,
    };
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = (rect.width - padding) / 2;
    const [hue, saturation] = this.rgbToHsl(r, g, b);
    const angle = (hue / 360) * 2 * Math.PI; // Convert to radians
    const normalizedSaturation = saturation / 100; // Convert to [0, 1]
    const x =
      centerX + radius * normalizedSaturation * Math.cos(angle) - padding;
    const y =
      centerY + radius * normalizedSaturation * Math.sin(angle) - padding;
    return { x, y };
  }

  getColorFromPosition(x, y, type = undefined) {
    // Return a color as hsl based on the position in the gradient
    const rect = { width: 360, height: 360 };
    const padding = 30; // each side
    const dotHalfSize = 29; // half the size of the dot. -11 for correct centering
    x += dotHalfSize;
    y += dotHalfSize;
    rect.width += padding * 2; // Adjust width and height for padding
    rect.height += padding * 2; // Adjust width and height for padding
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = (rect.width - padding) / 2;
    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2) - 0.2;
    let angle = Math.atan2(y - centerY, x - centerX);
    angle = (angle * 180) / Math.PI;
    if (angle < 0) {
      angle += 360;
    }
    const normalizedDistance = 1 - Math.min(distance / radius, 1);
    let hue = (angle / 360) * 360;
    let saturation = normalizedDistance * 100;
    if (type !== EXPLICIT_LIGHTNESS_TYPE) {
      saturation = 90 + (1 - normalizedDistance) * 10;
      // Set the current lightness to how far we are from the center of the circle
      // For example, moving the dot outside will have higher lightness, while moving it inside will have lower lightness
      this.#currentLightness = Math.round((1 - normalizedDistance) * 100);
    }
    let lightness = this.#currentLightness;
    if (type === EXPLICIT_BLACKWHITE_TYPE) {
      // We can only get grayscales from white to black
      saturation = 0;
      lightness = Math.round((1 - normalizedDistance) * 100);
    }
    const [r, g, b] = this.hslToRgb(
      hue / 360,
      saturation / 100,
      lightness / 100
    );
    return [
      Math.min(255, Math.max(0, r)),
      Math.min(255, Math.max(0, g)),
      Math.min(255, Math.max(0, b)),
    ];
  }


  calculateCompliments(dots, action = "update", useHarmony = "") {
    const colorHarmonies = this.colorHarmonies;

    if (dots.length === 0) {
      return [];
    }

    /* eslint-disable no-shadow */
    function getColorHarmonyType(numDots, dots) {
      if (useHarmony !== "") {
        const selectedHarmony = colorHarmonies.find(
          harmony => harmony.type === useHarmony
        );

        if (selectedHarmony) {
          if (action === "remove") {
            if (dots.length !== 0) {
              return colorHarmonies.find(
                harmony =>
                  harmony.angles.length === selectedHarmony.angles.length - 1
              );
            }
            return { type: "floating", angles: [] };
          }
          if (action === "add") {
            return colorHarmonies.find(
              harmony =>
                harmony.angles.length === selectedHarmony.angles.length + 1
            );
          }
          if (action === "update") {
            return selectedHarmony;
          }
        }
      }

      if (action === "remove") {
        let harmony = colorHarmonies.find(h => h.angles.length === numDots);
        // If we are coming from 3 analogous dots, we should now go to singleAnalogous if
        // there are 2 dots left
        if (harmony.type === "analogous" && numDots === 1) {
          harmony = colorHarmonies.find(h => h.type === "singleAnalogous");
        }
        return harmony;
      }
      if (action === "add") {
        return colorHarmonies.find(h => h.angles.length + 1 === numDots);
      }
      if (action === "update") {
        return colorHarmonies.find(h => h.angles.length + 1 === numDots);
      }
      return null;
    }

    function getAngleFromPosition(position, centerPosition) {
      let deltaX = position.x - centerPosition.x;
      let deltaY = position.y - centerPosition.y;
      let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
      return (angle + 360) % 360;
    }

    function getDistanceFromCenter(position, centerPosition) {
      const deltaX = position.x - centerPosition.x;
      const deltaY = position.y - centerPosition.y;
      return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }

    const rect = { width: 360, height: 360 };
    const padding = 0;

    let updatedDots = [...dots];
    const centerPosition = { x: rect.width / 2, y: rect.height / 2 };

    const harmonyAngles = getColorHarmonyType(
      /* eslint-disable no-nested-ternary */
      dots.length + (action === "add" ? 1 : action === "remove" ? -1 : 0),
      this.dots
    );
    this.useAlgo = harmonyAngles.type;
    if (!harmonyAngles || harmonyAngles.angles.length === 0) {
      return dots;
    }

    let primaryDot = dots.find(dot => dot.ID === 0);
    if (!primaryDot) {
      return [];
    }

    if (action === "add" && this.dots.length) {
      updatedDots.push({ ID: this.dots.length, position: centerPosition });
    }
    const baseAngle = getAngleFromPosition(primaryDot.position, centerPosition);
    let distance = getDistanceFromCenter(primaryDot.position, centerPosition);
    const radius = (rect.width - padding) / 2;
    if (distance > radius) {
      distance = radius;
    }
    if (this.dots.length) {
      updatedDots = [
        {
          ID: 0,
          position: primaryDot.position,
          type: primaryDot.type,
        },
      ];
    }

    harmonyAngles.angles.forEach((angleOffset, index) => {
      let newAngle = (baseAngle + angleOffset) % 360;
      let radian = (newAngle * Math.PI) / 180;

      let newPosition = {
        x: centerPosition.x + distance * Math.cos(radian),
        y: centerPosition.y + distance * Math.sin(radian),
      };

      updatedDots.push({
        ID: index + 1,
        position: newPosition,
        type: primaryDot.type,
      });
    });

    return updatedDots;
  }


  themedColors(colors) {
    // For non-Mica themes, we return the colors as they are
    return [...colors];
  }


  getToolbarModifiedBaseRaw() {
    const opacity = this.#allowTransparencyOnSidebar ? 0.6 : 1;
    return this.isDarkMode ? [23, 23, 26, opacity] : [240, 240, 244, opacity];
  }

  getToolbarModifiedBase() {
    const baseColor = this.getToolbarModifiedBaseRaw();
    return `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${baseColor[3]})`;
  }


  blendWithWhiteOverlay(baseColor, opacity) {
    let colorToBlend;
    let colorToBlendOpacity;
    if (this.isMica) {
      colorToBlend = this.isDarkMode ? [0, 0, 0] : [255, 255, 255];
      colorToBlendOpacity = 0.3;
    } else if (AppConstants.platform === "macosx") {
      colorToBlend = [255, 255, 255];
      colorToBlendOpacity = 0.6;
    }
    if (colorToBlend) {
      const blendedAlpha = Math.min(
        1,
        opacity +
          lazy.MIN_OPACITY +
          colorToBlendOpacity * (1 - (opacity + lazy.MIN_OPACITY))
      );
      baseColor = this.blendColors(baseColor, colorToBlend, blendedAlpha * 100);
      if (!this.canBeTransparent) {
        opacity += colorToBlendOpacity * (1 - opacity);
      }
    }
    return `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${opacity})`;
  }

  #getSingleRGBColor(color, forToolbar = false) {
    if (color.isCustom) {
      return color.c;
    }
    let opacity = this.currentOpacity;
    if (
      (forToolbar && !this.#allowTransparencyOnSidebar) ||
      (!forToolbar && !this.canBeTransparent)
    ) {
      color = this.blendColors(
        color.c,
        this.getToolbarModifiedBaseRaw().slice(0, 3),
        this.canBeTransparent ? 90 : opacity * 100
      );
      opacity = 1; // Toolbar colors should always be fully opaque
    } else {
      color = color.c;
    }
    if (this.isLegacyVersion && this.isDarkMode) {
      // In legacy version, we blend with white overlay or black overlay based on if we are in dark mode
      color = this.blendColors(color, [0, 0, 0], 30);
    }
    return this.blendWithWhiteOverlay(color, opacity);
  }

  luminance([r, g, b]) {
    // These magic numbers are extracted from the wikipedia article on relative luminance
    // https://en.wikipedia.org/wiki/Relative_luminance
    var a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  contrastRatio(rgb1, rgb2) {
    const lum1 = this.luminance(rgb1);
    const lum2 = this.luminance(rgb2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  blendColors(rgb1, rgb2, percentage) {
    const p = percentage / 100;
    return [
      Math.round(rgb1[0] * p + rgb2[0] * (1 - p)),
      Math.round(rgb1[1] * p + rgb2[1] * (1 - p)),
      Math.round(rgb1[2] * p + rgb2[2] * (1 - p)),
    ];
  }

  getGradient(colors, forToolbar = false) {
    const themedColors = this.themedColors(colors);
    this.useAlgo = themedColors[0]?.algorithm ?? "";
    this.#currentLightness = themedColors[0]?.lightness ?? 50;

    const rotation = -30; // TODO: Detect rotation based on the accent color
    if (themedColors.length === 0) {
      const getBrowserBg = () => {
        if (this.canBeTransparent) {
          return this.isDarkMode ? "rgba(0, 0, 0, 0.4)" : "transparent";
        }
        return this.isDarkMode ? "#131313" : "#e9e9e9";
      };
      return forToolbar ? this.getToolbarModifiedBase() : getBrowserBg();
    } else if (themedColors.length === 1) {
      return this.#getSingleRGBColor(themedColors[0], forToolbar);
    }
    // If there are custom colors, we just return a linear gradient with all colors
    if (themedColors.find(color => color.isCustom)) {
      // Just return a linear gradient with all colors
      const gradientColors = themedColors.map(color =>
        this.#getSingleRGBColor(color, forToolbar)
      );
      // Divide all colors evenly in the gradient
      const colorStops = gradientColors
        .map((color, index) => {
          const position = (index / (gradientColors.length - 1)) * 100;
          return `${color} ${position}%`;
        })
        .join(", ");
      return `linear-gradient(${rotation}deg, ${colorStops})`;
    }
    if (themedColors.length === 2) {
      if (!forToolbar) {
        return [
          `linear-gradient(${rotation}deg, ${this.#getSingleRGBColor(themedColors[1], forToolbar)} 30%, transparent 120%)`,
          `linear-gradient(${rotation + 180}deg, ${this.#getSingleRGBColor(themedColors[0], forToolbar)} 30%, transparent 120%)`,
        ]
          .reverse()
          .join(", ");
      }
      return `linear-gradient(${rotation}deg, ${this.#getSingleRGBColor(themedColors[1], forToolbar)} 0%, ${this.#getSingleRGBColor(themedColors[0], forToolbar)} 100%)`;
    } else if (themedColors.length === 3) {
      let color1 = this.#getSingleRGBColor(themedColors[2], forToolbar);
      let color2 = this.#getSingleRGBColor(themedColors[0], forToolbar);
      let color3 = this.#getSingleRGBColor(themedColors[1], forToolbar);
      return [
        `linear-gradient(-5deg, ${color1} 10%, transparent 80%)`,
        `radial-gradient(circle at 95% 0%, ${color3} 0%, transparent 75%)`,
        `radial-gradient(circle at 0% 0%, ${color2} 10%, transparent 70%)`,
      ].join(", ");
    }
    // We shouldn't really reach here but just in case, we return an empty array
    return [];
  }


  hexToRgb(hex) {
    if (hex.startsWith("#")) {
      hex = hex.substring(1);
    }
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map(char => char + char)
        .join("");
    }
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16),
    ];
  }


}
