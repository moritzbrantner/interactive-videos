import { useEffect, useState } from 'react';
import { useDelayRender } from 'remotion';

import { moenarchShortV1Tokens as tokens } from './tokens';

// The document owns its registered faces; every composition shares one load and its outcome.
const documents = new WeakMap<Document, Promise<void>>();

function loadFonts(document: Document): Promise<void> {
  const existing = documents.get(document);
  if (existing) {
    return existing;
  }
  const loading = Promise.all(tokens.fonts.map(async (font) => {
    const family = font.family === 'display' ? tokens.typography.displayFamily : tokens.typography.fontFamily;
    const source = new URL(`${import.meta.env.BASE_URL}${font.path}`, document.baseURI).href;
    const face = new FontFace(family.replace(/^['"]|['"]$/g, ''), `url(${JSON.stringify(source)}) format("woff2")`, {
      weight: font.weight,
      style: font.style,
    });
    document.fonts.add(face);
    await face.load();
  })).then(() => undefined);
  documents.set(document, loading);
  return loading;
}

/** Both Player and Remotion wait for the same packaged faces before showing any text. */
export function useMoenarchFonts(): boolean {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender('Loading packaged moenarch-short fonts'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const complete = () => {
      if (active) {
        setReady(true);
      }
      continueRender(handle);
    };
    loadFonts(document).then(complete, (error: unknown) => {
      if (active) {
        cancelRender(error);
      }
    });
    return () => {
      active = false;
      continueRender(handle);
    };
  }, [cancelRender, continueRender, handle]);

  return ready;
}
