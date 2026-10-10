// moenarch-short v1: every format choice of the pack as one versioned, deep-frozen data object.
//
// The house style is an editorial "slate and ochre" look: a warm charcoal ground, off-white serif
// headlines, a quiet sans for eyebrows and subtitles, and one accent used sparingly for rules and
// the signature mark. Motion is short and vertical-first; nothing bounces or overshoots.
//
// This module is plain data (JSON-serializable, no React or Remotion), so tests, tooling and a
// headless renderer can read it. Components and the plan read values from here and restate none.
// A new look is a new version, not an edit: change v1 only to fix mistakes.

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Projects may pick one of these as the accent; nothing else is overridable. */
const accents = {
  ochre: '#d9a441',
  verdigris: '#5fa79b',
  brick: '#c8664f',
} as const;

const tokens = {
  id: 'moenarch-short',
  version: 1,

  // Portrait short. The safe area keeps text clear of platform chrome: the top bar, the action
  // column on the right and the caption/description block at the bottom.
  output: {
    width: 1080,
    height: 1920,
    fps: 30,
    safeArea: { top: 192, right: 144, bottom: 384, left: 96 },
  },

  typography: {
    // Sans for eyebrows, subtitles and the signature label.
    fontFamily: "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    // Serif for headlines.
    displayFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
    // Pixel sizes on the 1080-wide frame: small steps for text, one large jump to the headline.
    scale: { signature: 26, eyebrow: 34, subtitle: 46, display: 96 },
    weight: { regular: 400, medium: 560, display: 600 },
    lineHeight: { display: 1.04, text: 1.3 },
    letterSpacing: { eyebrow: 0.16, display: -0.012, signature: 0.24 },
    // Headlines wrap into at most three short lines; longer headings are unrenderable.
    density: { maxCharsPerLine: 14, maxLines: 3 },
    subtitleMaxCharsPerLine: 32,
  },

  palette: {
    background: '#15171b',
    surface: '#1e2127',
    text: '#efebe3',
    muted: '#9b978d',
    rule: '#3a3e46',
    accent: accents.ochre,
  },

  surfaces: {
    subtitle: { background: '#0e0f12d9', radius: 14, paddingX: 26, paddingY: 14 },
    outro: { background: '#1e2127', radius: 0 },
  },

  spacing: {
    unit: 8,
    eyebrowGap: 28,
    ruleGap: 44,
    ruleWidth: 132,
    ruleThickness: 8,
    // Headline block sits slightly above the optical centre of the safe area.
    headlineAnchor: 0.42,
    subtitleOffset: 24,
  },

  pacing: {
    minSceneDurationInFrames: 60,
    defaultSceneDurationInFrames: 90,
    maxSceneDurationInFrames: 180,
    // Scene boundaries take transitions from this cycle in order, so a plan is deterministic and
    // a short with five boundaries shows the whole vocabulary.
    transitionCycle: ['lift', 'dissolve', 'slide', 'cut'],
  },

  // The whole transition vocabulary. A window is centred on the scene boundary.
  transitions: {
    cut: { durationInFrames: 0, motion: false, easing: 'linear' },
    dissolve: { durationInFrames: 14, motion: false, easing: 'standard' },
    lift: { durationInFrames: 18, motion: true, easing: 'enter', distance: 96 },
    slide: { durationInFrames: 18, motion: true, easing: 'standard', distance: 180 },
  },

  // Cubic-bezier control points (x1, y1, x2, y2), turned into Remotion easing by the pack.
  easing: {
    linear: [0, 0, 1, 1],
    standard: [0.3, 0, 0.1, 1],
    enter: [0.12, 0.7, 0.2, 1],
    exit: [0.4, 0, 0.9, 0.3],
  },

  // Image/video scenes (added with media scene kinds): fill the frame, keep the focal point in
  // the safe area, and darken toward the subtitle band so text stays legible.
  media: {
    fit: 'cover',
    focalPoint: { x: 0.5, y: 0.4 },
    scrim: { color: '#15171b', opacityTop: 0, opacityBottom: 0.72 },
    cornerRadius: 0,
  },

  subtitles: {
    placement: 'bottom',
    maxLines: 2,
    align: 'center',
  },

  signature: {
    label: 'moenarch',
    // Intro: the accent rule draws in under the label. Outro: the surface closes in over the last
    // scene and the label settles at its centre.
    intro: { durationInFrames: 24, easing: 'enter', rise: 32 },
    outro: { durationInFrames: 36, easing: 'standard', rise: 40 },
    // The recurring mark: three stacked bars of falling width beside the label.
    mark: { barWidths: [36, 26, 16], barHeight: 6, barGap: 6 },
  },

  reducedMotion: {
    // Moving transitions become this motionless one, over the same window.
    transition: 'dissolve',
    // Intro and outro keep their timing but only change opacity.
    signature: 'fade',
  },

  accents,
} as const;

type V1 = typeof tokens;
/** The v1 token shape; a project's accent override only swaps `palette.accent`. */
export type MoenarchShortTokens = Omit<V1, 'palette'> & {
  readonly palette: Omit<V1['palette'], 'accent'> & { readonly accent: string };
};
export type MoenarchTransitionName = keyof MoenarchShortTokens['transitions'];
export type MoenarchEasingName = keyof MoenarchShortTokens['easing'];
export type MoenarchAccentName = keyof MoenarchShortTokens['accents'];

export const moenarchShortV1Tokens: MoenarchShortTokens = deepFreeze(tokens);
