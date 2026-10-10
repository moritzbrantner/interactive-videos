import { memo } from 'react';

import { ContentFrame, Entrance, Rule, TextBlock, type MoenarchSceneProps } from './parts';

/** Statement/emphasis: one sentence in large serif, its emphasis in the accent. */
export const StatementScene = memo(function StatementScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { gaps } = tokens.scenes;
  const eyebrow = scene.layout.blocks.find((block) => block.role === 'eyebrow');
  const statement = scene.layout.blocks.find((block) => block.role === 'statement')!;
  return (
    <ContentFrame tokens={tokens}>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={0} style={{ marginBottom: gaps.block }}>
        <Rule tokens={tokens} />
      </Entrance>
      {eyebrow ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={1} style={{ marginBottom: gaps.block }}>
          <TextBlock block={eyebrow} tokens={tokens} />
        </Entrance>
      ) : null}
      <Entrance tokens={tokens} enterFrom={enterFrom} step={2}>
        <TextBlock block={statement} tokens={tokens} />
      </Entrance>
    </ContentFrame>
  );
});
