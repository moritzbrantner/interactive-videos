import { useEffect, useState, type RefObject } from 'react';

import type { PlayerRef } from '@remotion/player';

import type { Chapter } from '@/catalog/catalog';

/** The chapter whose [from, from + durationInFrames) contains `frame`. */
export function currentChapterId(chapters: readonly Chapter[], frame: number): string | undefined {
  return chapters.find((chapter) => frame >= chapter.from && frame < chapter.from + chapter.durationInFrames)?.id
    ?? chapters.at(-1)?.id;
}

/**
 * Chapter jumps and related-segment jumps on the single fixed timeline (Atlas 1.8). Lives at the
 * Player boundary, outside the composition. A jump only seeks: it keeps the current play state.
 */
export function ChapterNav({ chapters, player }: { chapters: readonly Chapter[]; player: RefObject<PlayerRef | null> }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const update = () => setFrame(instance.getCurrentFrame());
    update();
    instance.addEventListener('frameupdate', update);
    instance.addEventListener('seeked', update);
    return () => {
      instance.removeEventListener('frameupdate', update);
      instance.removeEventListener('seeked', update);
    };
  }, [player]);

  const jump = (chapter: Chapter) => {
    player.current?.seekTo(chapter.from);
    setFrame(chapter.from);
  };

  const currentId = currentChapterId(chapters, frame);
  const current = chapters.find((chapter) => chapter.id === currentId);
  const related = current?.relatedId ? chapters.find((chapter) => chapter.id === current.relatedId) : undefined;

  return (
    <>
    <nav aria-label="Chapters" className="chapters">
      <ol>
        {chapters.map((chapter, index) => (
          <li key={chapter.id}>
            <button
              type="button"
              data-chapter-id={chapter.id}
              data-chapter-from={chapter.from}
              aria-current={chapter.id === currentId ? 'true' : undefined}
              onClick={() => jump(chapter)}
            >
              {index + 1}. {chapter.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
      {related ? (
        <button
          type="button"
          className="related-segment"
          data-related-segment=""
          data-chapter-target={related.id}
          onClick={() => jump(related)}
        >
          Jump to the conclusion: {related.title}
        </button>
      ) : null}
    </>
  );
}
