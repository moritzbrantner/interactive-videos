import { memo } from 'react';

import { ContentFrame, Entrance, Rule, TextBlock, type MoenarchSceneProps } from './parts';

/** Conclusion/outro: the closing line in serif over the accent rule, and the takeaway. */
export const ConclusionScene = memo(function ConclusionScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { gaps } = tokens.scenes;
  const heading = scene.layout.blocks.find((block) => block.role === 'heading')!;
  const takeaway = scene.layout.blocks.find((block) => block.role === 'takeaway');
  return (
    <ContentFrame tokens={tokens} align="anchor">
      <Entrance tokens={tokens} enterFrom={enterFrom} step={0}>
        <TextBlock block={heading} tokens={tokens} />
      </Entrance>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={1} style={{ marginBlock: gaps.section }}>
        <Rule tokens={tokens} />
      </Entrance>
      {takeaway ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={2}>
          <TextBlock block={takeaway} tokens={tokens} />
        </Entrance>
      ) : null}
    </ContentFrame>
  );
});
