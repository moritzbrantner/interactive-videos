import { memo } from 'react';

import { ContentFrame, Entrance, TextBlock, textStyle, type MoenarchSceneProps } from './parts';

/** List/progression: items appear one after another; an ordered list numbers its steps. */
export const ListScene = memo(function ListScene({ scene, tokens, enterFrom }: MoenarchSceneProps) {
  const { gaps, text } = tokens.scenes;
  const { blocks, ordered } = scene.layout;
  const heading = blocks.find((block) => block.role === 'heading');
  const items = blocks.filter((block) => block.role === 'item');
  const itemStyle = text[tokens.scenes.archetypes.list.item.style];
  // The marker column is one em of the item style wide plus its gap, and sits on the first line.
  const markerSize = itemStyle.size;
  const List = ordered ? 'ol' : 'ul';
  return (
    <ContentFrame tokens={tokens}>
      {heading ? (
        <Entrance tokens={tokens} enterFrom={enterFrom} step={0} style={{ marginBottom: gaps.section }}>
          <TextBlock block={heading} tokens={tokens} />
        </Entrance>
      ) : null}
      <List style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: gaps.item }}>
        {items.map((item, index) => (
          <li key={index} style={{ margin: 0, padding: 0 }}>
            <Entrance tokens={tokens} enterFrom={enterFrom} step={1 + index} style={{ display: 'flex', gap: gaps.marker }}>
              <div
                aria-hidden
                style={{
                  ...textStyle(tokens, 'label'),
                  color: tokens.palette.accent,
                  width: markerSize,
                  height: markerSize * itemStyle.lineHeight,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: itemStyle.size,
                  lineHeight: itemStyle.lineHeight,
                }}
              >
                {ordered ? (
                  index + 1
                ) : (
                  <div style={{ width: markerSize / 3, height: markerSize / 3, background: tokens.palette.accent }} />
                )}
              </div>
              <TextBlock block={item} tokens={tokens} />
            </Entrance>
          </li>
        ))}
      </List>
    </ContentFrame>
  );
});
