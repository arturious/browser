/* MPL-2.0. Generated from ZenLibraryMediaPreview.mjs; only origin/parts and window access are adapted. */
const MORPH_MS = 250;
// How far in the picture gives way to the dialog around it.
// Matches the corner the grid's pictures have.
const MEDIA_RADIUS = 8;
const HANDOVER = 0.3;
// How soon the dialog's surfaces are gone on the way back.
const CHROME_OUT = 0.25;
// How long to hold the dialog back while the picture readies itself.
const IMAGE_WAIT_MS = 400;
const VIDEO_WAIT_MS = 900;
const MORPH_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function morphMedia(parts, origin, opening) {
    const { panel, backdrop, header, stage } = parts;
    const base = {
      duration: MORPH_MS,
      easing: MORPH_EASING,
      fill: "both",
    };
    const steps = keyframes =>
      opening
        ? keyframes
        : [...keyframes]
            .reverse()
            .map(frame =>
              frame.offset === undefined
                ? frame
                : { ...frame, offset: 1 - frame.offset }
            );
    const chrome = { ...base, easing: "linear" };
    const fadeOut = arriving =>
      opening
        ? arriving
        : [
            { ...arriving.at(-1), offset: 0 },
            { ...arriving[0], offset: CHROME_OUT },
            { ...arriving[0], offset: 1 },
          ];
    backdrop.animate(fadeOut([{ opacity: 0 }, { opacity: 1 }]), chrome);
    const from = origin && { ...origin, left: origin.x, top: origin.y };
    const to = panel.getBoundingClientRect();
    if (!from?.width || !to.width) {
      return backdrop.animate(
        fadeOut([{ opacity: 0 }, { opacity: 1 }]),
        chrome
      );
    }
    const media = stage?.querySelector(".zen-library-media-preview-media");
    const shown = media?.getBoundingClientRect();
    const target = shown?.width ? shown : to;
    const scale = from.width / target.width;
    const centre = box => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    });
    const panelCentre = centre(to);
    const shownCentre = centre(target);
    const cardCentre = centre(from);
    const atCard =
      `translate(${cardCentre.x - panelCentre.x - scale * (shownCentre.x - panelCentre.x)}px, ` +
      `${cardCentre.y - panelCentre.y - scale * (shownCentre.y - panelCentre.y)}px) ` +
      `scale(${scale})`;
    const panelStyle = window.getComputedStyle(panel);
    const late = (values, property) => {
      const hidden = property === "boxShadow" ? "none" : "transparent";
      return opening
        ? [
            { [property]: hidden, offset: 0 },
            { [property]: hidden, offset: HANDOVER },
            { [property]: values, offset: 1 },
          ]
        : [
            { [property]: values, offset: 0 },
            { [property]: hidden, offset: CHROME_OUT },
            { [property]: hidden, offset: 1 },
          ];
    };
    panel.animate(late(panelStyle.backgroundColor, "backgroundColor"), chrome);
    panel.animate(late(panelStyle.boxShadow, "boxShadow"), chrome);
    if (stage) {
      const stageStyle = window.getComputedStyle(stage);
      stage.animate(
        late(stageStyle.backgroundColor, "backgroundColor"),
        chrome
      );
      stage.animate(late(stageStyle.borderTopColor, "borderTopColor"), chrome);
    }
    header.animate(
      fadeOut([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: HANDOVER },
        { opacity: 1, offset: 1 },
      ]),
      chrome
    );
    if (media && shown?.width) {
      media.animate(
        steps([
          { borderRadius: `${Math.round(MEDIA_RADIUS / scale)}px` },
          { borderRadius: `${MEDIA_RADIUS}px` },
        ]),
        base
      );
    }
    return panel.animate(
      steps([{ transform: atCard }, { transform: "none" }]),
      base
    );
  }
