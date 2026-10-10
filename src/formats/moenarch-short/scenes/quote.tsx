import { memo } from 'react';

import { ContentFrame, Entrance, Rule, TextBlock, type MoenarchSceneProps } from './parts';

/** Quote/callout: the quote in serif italic under the accent rule, then its attribution. */
export const QuoteScene = memo(function QuoteScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { gaps } = tokens.scenes;
  const quote = scene.layout.blocks.find((block) => block.role === 'quote')!;
  const attribution = scene.layout.blocks.find((block) => block.role === 'attribution');
  return (
    <ContentFrame tokens={tokens}>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={0} style={{ marginBottom: gaps.section }}>
        <Rule tokens={tokens} />
      </Entrance>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={1}>
        <TextBlock block={quote} tokens={tokens} />
      </Entrance>
      {attribution ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={2} style={{ marginTop: gaps.section }}>
          <TextBlock block={attribution} tokens={tokens} />
        </Entrance>
      ) : null}
    </ContentFrame>
  );
});
