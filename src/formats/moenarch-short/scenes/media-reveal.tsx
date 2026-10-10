import { memo } from 'react';
import { AbsoluteFill, Img } from 'remotion';

import { ContentFrame, Entrance, TextBlock, type MoenarchSceneProps } from './parts';

/** Illustration/media reveal: a static image fills the frame under a scrim, with an optional caption. */
export const MediaRevealScene = memo(function MediaRevealScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const media = scene.layout.media!;
  const { fit, focalPoint, scrim, cornerRadius } = tokens.media;
  const caption = scene.layout.blocks.find((block) => block.role === 'caption');
  const tint = (opacity: number) => `color-mix(in srgb, ${scrim.color} ${opacity * 100}%, transparent)`;
  return (
    <>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={0} style={{ position: 'absolute', inset: 0 }}>
        <Img
          data-moenarch-media=""
          src={`${import.meta.env.BASE_URL}${media.staticPath}`}
          alt={media.alt}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: fit,
            objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%`,
            borderRadius: cornerRadius,
          }}
        />
      </Entrance>
      <AbsoluteFill
        style={{ background: `linear-gradient(to bottom, ${tint(scrim.opacityTop)}, ${tint(scrim.opacityBottom)})` }}
      />
      {caption ? (
        <ContentFrame tokens={tokens} align="end">
          <Entrance tokens={tokens} enterFrom={enterFrom} step={2}>
            <TextBlock block={caption} tokens={tokens} />
          </Entrance>
        </ContentFrame>
      ) : null}
    </>
  );
});
