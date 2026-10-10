import { memo } from 'react';

import { ContentFrame, Entrance, Rule, TextBlock, type MoenarchSceneProps } from './parts';

/** Hook/title: an eyebrow over a large serif headline, closed by the accent rule. */
export const TitleScene = memo(function TitleScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { spacing } = tokens;
  const eyebrow = scene.layout.blocks.find((block) => block.role === 'eyebrow');
  const heading = scene.layout.blocks.find((block) => block.role === 'heading')!;
  return (
    <ContentFrame tokens={tokens} align="anchor">
      {eyebrow ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={0} style={{ marginBottom: spacing.eyebrowGap }}>
          <TextBlock block={eyebrow} tokens={tokens} />
        </Entrance>
      ) : null}
      <Entrance tokens={tokens} enterFrom={enterFrom} step={1}>
        <TextBlock block={heading} tokens={tokens} heading />
      </Entrance>
      <Entrance tokens={tokens} enterFrom={enterFrom} step={2} style={{ marginTop: spacing.ruleGap }}>
        <Rule tokens={tokens} width={spacing.ruleWidth} />
      </Entrance>
    </ContentFrame>
  );
});
