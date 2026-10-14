// Observational browser code shared by Player and Remotion acceptance. Never changes the DOM,
// waits for fonts, or measures on behalf of the production layout algorithm.
export function observeTypography() {
  const root = document.querySelector<HTMLElement>('[data-moenarch-root]');
  if (!root) {
    throw new Error('Typography composition is not mounted');
  }
  const scale = root.getBoundingClientRect().width / 1080;
  const origin = root.getBoundingClientRect();
  const box = (rect: DOMRect) => ({
    left: (rect.left - origin.left) / scale,
    right: (rect.right - origin.left) / scale,
    top: (rect.top - origin.top) / scale,
    bottom: (rect.bottom - origin.top) / scale,
  });
  return [...root.querySelectorAll<HTMLElement>('[data-moenarch-text]')].map((element) => {
    const style = getComputedStyle(element);
    const fragments = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) {
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      fragments.push(...[...range.getClientRects()].filter((rect) => rect.width > 0).map(box));
    }
    const family = style.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    const faces = [...document.fonts].filter((face) => face.family.replace(/^['"]|['"]$/g, '') === family);
    return {
      role: element.dataset.moenarchText,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      fontSize: Number.parseFloat(style.fontSize),
      family,
      loaded: faces.some((face) => face.status === 'loaded') && document.fonts.check(
        `${style.fontStyle} ${style.fontWeight} ${style.fontSize} \"${family}\"`, element.textContent ?? '',
      ),
      box: box(element.getBoundingClientRect()),
      fragments,
    };
  });
}

export type TypographyObservation = ReturnType<typeof observeTypography>;
