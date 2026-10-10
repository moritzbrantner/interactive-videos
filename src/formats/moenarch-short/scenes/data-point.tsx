import { memo } from 'react';

import { ContentFrame, Entrance, Rule, TextBlock, type MoenarchSceneProps } from './parts';

/** Diagram/data point: one large figure in the accent, what it counts, and optional context. */
export const DataPointScene = memo(function DataPointScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { gaps } = tokens.scenes;
  const { blocks } = scene.layout;
  const value = blocks.find((block) => block.role === 'value')!;
  const label = blocks.find((block) => block.role === 'label')!;
  const context = blocks.find((block) => block.role === 'context');
  return (
    <ContentFrame tokens={tokens}>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={0}>
        <TextBlock block={value} tokens={tokens} />
      </Entrance>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={1} style={{ marginBlock: gaps.block }}>
        <Rule tokens={tokens} color={tokens.palette.rule} />
      </Entrance>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={1}>
        <TextBlock block={label} tokens={tokens} />
      </Entrance>
      {context ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={2} style={{ marginTop: gaps.section }}>
          <TextBlock block={context} tokens={tokens} />
        </Entrance>
      ) : null}
    </ContentFrame>
  );
});
