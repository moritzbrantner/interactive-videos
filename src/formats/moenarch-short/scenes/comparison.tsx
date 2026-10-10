import { memo } from 'react';

import { ContentFrame, Entrance, Rule, TextBlock, type MoenarchSceneProps } from './parts';

/** Comparison: two sides stacked, each a label over its detail, divided by a quiet rule. */
export const ComparisonScene = memo(function ComparisonScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { gaps } = tokens.scenes;
  const { blocks } = scene.layout;
  const heading = blocks.find((block) => block.role === 'heading');
  const labels = blocks.filter((block) => block.role === 'label');
  const details = blocks.filter((block) => block.role === 'detail');
  return (
    <ContentFrame tokens={tokens}>
      {heading ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={0} style={{ marginBottom: gaps.section }}>
          <TextBlock block={heading} tokens={tokens} />
        </Entrance>
      ) : null}
      {labels.map((label, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', alignSelf: 'stretch' }}>
          {index > 0 ? (
            <Entrance tokens={tokens} enterFrom={enterFrom} step={1 + index * 2} style={{ alignSelf: 'stretch', marginBlock: gaps.section / 2 }}>
              <Rule tokens={tokens} color={tokens.palette.rule} width="100%" />
            </Entrance>
          ) : null}
          <Entrance tokens={tokens} enterFrom={enterFrom} step={1 + index * 2} style={{ marginBottom: gaps.item }}>
            <TextBlock block={label} tokens={tokens} />
          </Entrance>
          <Entrance tokens={tokens} enterFrom={enterFrom} step={2 + index * 2}>
            <TextBlock block={details[index]} tokens={tokens} />
          </Entrance>
        </div>
      ))}
    </ContentFrame>
  );
});
