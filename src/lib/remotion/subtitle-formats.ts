export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa' | 'lrc' | 'sbv' | 'json';
export type SubtitleFormatInput = SubtitleFormat | 'auto';

export type SubtitleCueStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  underline?: boolean;
  strikeThrough?: boolean;
  color?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  letterSpacing?: number;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  alignment?: number;
  marginLeft?: number;
  marginRight?: number;
  marginVertical?: number;
  borderStyle?: number;
};

export type SubtitleSpan = {
  text: string;
  style?: SubtitleCueStyle;
  classes?: string[];
  startOffsetMs?: number;
  endOffsetMs?: number;
};

export type SubtitleCuePosition = {
  x?: number;
  y?: number;
  coordinateSpace?: 'script' | 'percent';
  alignment?: number;
  line?: string;
  position?: string;
  size?: string;
  vertical?: string;
};

export type SubtitleCueMove = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startOffsetMs?: number;
  endOffsetMs?: number;
};

export type SubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  spans: SubtitleSpan[];
  styleName?: string;
  style?: SubtitleCueStyle;
  position?: SubtitleCuePosition;
  move?: SubtitleCueMove;
  fade?: { inMs: number; outMs: number };
  layer?: number;
  actor?: string;
  raw?: string;
};

export type SubtitleTrack = {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  styles?: Record<string, SubtitleCueStyle>;
  metadata?: Record<string, string>;
  scriptWidth?: number;
  scriptHeight?: number;
  warnings?: string[];
};

export type ParseSubtitleInput = {
  input: string;
  format?: SubtitleFormatInput;
  fileName?: string;
  defaultCueDurationMs?: number;
};

type MarkupResult = {
  text: string;
  spans: SubtitleSpan[];
  actor?: string;
};

const normalizeInput = (input: string) => input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function parseClockTimestamp(value: string) {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Invalid subtitle timestamp: ${value}`);
  }

  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) {
    throw new Error(`Invalid subtitle timestamp: ${value}`);
  }

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function splitLimited(value: string, count: number) {
  if (count <= 1) return [value];
  const result: string[] = [];
  let rest = value;
  for (let index = 0; index < count - 1; index++) {
    const comma = rest.indexOf(',');
    if (comma < 0) {
      result.push(rest);
      rest = '';
      break;
    }
    result.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  result.push(rest);
  while (result.length < count) result.push('');
  return result;
}

function parseHtmlishMarkup(input: string): MarkupResult {
  const spans: SubtitleSpan[] = [];
  const stack: Array<{ tag: string; previous: SubtitleCueStyle; previousClasses: string[] }> = [];
  let style: SubtitleCueStyle = {};
  let classes: string[] = [];
  let actor: string | undefined;
  let plain = '';
  let cursor = 0;

  const append = (raw: string) => {
    const text = decodeEntities(raw.replace(/<br\s*\/?\s*>/gi, '\n'));
    if (!text) return;
    plain += text;
    spans.push({
      text,
      style: Object.keys(style).length ? { ...style } : undefined,
      classes: classes.length ? [...classes] : undefined,
    });
  };

  const tagPattern = /<([^>]+)>/g;
  for (const match of input.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    append(input.slice(cursor, index));
    cursor = index + match[0].length;

    const source = match[1].trim();
    if (!source) continue;
    if (source.startsWith('!')) continue;

    const closing = source.startsWith('/');
    const tagSource = closing ? source.slice(1).trim() : source;
    const name = tagSource.split(/[\s.]/, 1)[0].toLowerCase();

    if (closing) {
      const stackIndex = stack.map((entry) => entry.tag).lastIndexOf(name);
      if (stackIndex >= 0) {
        const entry = stack[stackIndex];
        style = entry.previous;
        classes = entry.previousClasses;
        stack.splice(stackIndex);
      }
      continue;
    }

    const previous = { ...style };
    const previousClasses = [...classes];
    stack.push({ tag: name, previous, previousClasses });

    if (name === 'b') style = { ...style, fontWeight: 'bold' };
    else if (name === 'i') style = { ...style, fontStyle: 'italic' };
    else if (name === 'u') style = { ...style, underline: true };
    else if (name === 'font') {
      const color = tagSource.match(/\bcolor\s*=\s*["']?([^\s"'>]+)/i)?.[1];
      if (color) style = { ...style, color };
    } else if (name === 'c') {
      const classPart = tagSource.slice(1).replace(/^\./, '');
      classes = classPart ? classPart.split('.').filter(Boolean) : [];
    } else if (name === 'v') {
      const voice = tagSource.slice(1).trim();
      if (voice) actor = voice;
    }
  }

  append(input.slice(cursor));
  return { text: plain, spans, actor };
}

function assColorToCss(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^&H/i, '').replace(/&$/, '');
  if (!/^[0-9a-f]+$/i.test(cleaned)) return undefined;
  const padded = cleaned.padStart(8, '0').slice(-8);
  const alpha = 255 - Number.parseInt(padded.slice(0, 2), 16);
  const blue = Number.parseInt(padded.slice(2, 4), 16);
  const green = Number.parseInt(padded.slice(4, 6), 16);
  const red = Number.parseInt(padded.slice(6, 8), 16);
  const opacity = Math.round((alpha / 255) * 1000) / 1000;
  return opacity >= 0.999
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function assBoolean(value: string | undefined) {
  if (value === undefined) return undefined;
  return Number(value) !== 0;
}

function numeric(value: string | undefined) {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAssStyle(fields: Record<string, string>): SubtitleCueStyle {
  const bold = assBoolean(fields.bold);
  return {
    fontFamily: fields.fontname || undefined,
    fontSize: numeric(fields.fontsize),
    fontWeight: bold === undefined ? undefined : bold ? 'bold' : 'normal',
    fontStyle: assBoolean(fields.italic) ? 'italic' : undefined,
    underline: assBoolean(fields.underline),
    strikeThrough: assBoolean(fields.strikeout),
    color: assColorToCss(fields.primarycolour),
    secondaryColor: assColorToCss(fields.secondarycolour),
    outlineColor: assColorToCss(fields.outlinecolour ?? fields.tertiarycolour),
    shadowColor: assColorToCss(fields.backcolour),
    letterSpacing: numeric(fields.spacing),
    outlineWidth: numeric(fields.outline),
    shadowOffsetX: numeric(fields.shadow),
    shadowOffsetY: numeric(fields.shadow),
    scaleX: numeric(fields.scalex) === undefined ? undefined : numeric(fields.scalex)! / 100,
    scaleY: numeric(fields.scaley) === undefined ? undefined : numeric(fields.scaley)! / 100,
    rotation: numeric(fields.angle),
    alignment: numeric(fields.alignment),
    marginLeft: numeric(fields.marginl),
    marginRight: numeric(fields.marginr),
    marginVertical: numeric(fields.marginv),
    borderStyle: numeric(fields.borderstyle),
  };
}

function mapFields(format: string[], values: string[]) {
  return Object.fromEntries(format.map((name, index) => [name.toLowerCase(), values[index]?.trim() ?? '']));
}

function parseAssDialogueText(
  raw: string,
  baseStyle: SubtitleCueStyle,
  styles: Record<string, SubtitleCueStyle>,
  warnings: string[],
) {
  let activeStyle = { ...baseStyle };
  let alignment = baseStyle.alignment;
  let position: SubtitleCuePosition | undefined;
  let move: SubtitleCueMove | undefined;
  let fade: SubtitleCue['fade'];
  let karaokeCursor = 0;
  let pendingKaraokeMs: number | undefined;
  const spans: SubtitleSpan[] = [];
  let text = '';
  let cursor = 0;

  const appendText = (chunk: string) => {
    const decoded = chunk.replace(/\\N|\\n/g, '\n').replace(/\\h/g, '\u00a0');
    if (!decoded) return;
    const span: SubtitleSpan = { text: decoded, style: { ...activeStyle } };
    if (pendingKaraokeMs !== undefined) {
      span.startOffsetMs = karaokeCursor;
      span.endOffsetMs = karaokeCursor + pendingKaraokeMs;
      karaokeCursor += pendingKaraokeMs;
      pendingKaraokeMs = undefined;
    }
    spans.push(span);
    text += decoded;
  };

  const applyBlock = (block: string) => {
    const tagPattern = /\\([1-4]?[a-zA-Z]+)([^\\}]*)/g;
    for (const match of block.matchAll(tagPattern)) {
      const tag = match[1].toLowerCase();
      const argument = match[2].trim();
      const number = numeric(argument.replace(/^\(|\)$/g, ''));

      if (tag === 'b') activeStyle.fontWeight = Number(argument || '1') === 0 ? 'normal' : 'bold';
      else if (tag === 'i') activeStyle.fontStyle = Number(argument || '1') === 0 ? 'normal' : 'italic';
      else if (tag === 'u') activeStyle.underline = Number(argument || '1') !== 0;
      else if (tag === 's') activeStyle.strikeThrough = Number(argument || '1') !== 0;
      else if (tag === 'fs' && number !== undefined) activeStyle.fontSize = number;
      else if (tag === 'fn') activeStyle.fontFamily = argument || baseStyle.fontFamily;
      else if ((tag === 'c' || tag === '1c') && argument) activeStyle.color = assColorToCss(argument);
      else if (tag === '2c' && argument) activeStyle.secondaryColor = assColorToCss(argument);
      else if (tag === '3c' && argument) activeStyle.outlineColor = assColorToCss(argument);
      else if (tag === '4c' && argument) activeStyle.shadowColor = assColorToCss(argument);
      else if (tag === 'alpha' || tag === '1a') {
        const hex = argument.replace(/^&H/i, '').replace(/&$/, '');
        if (/^[0-9a-f]{1,2}$/i.test(hex)) activeStyle.opacity = 1 - Number.parseInt(hex, 16) / 255;
      } else if (tag === 'bord' && number !== undefined) activeStyle.outlineWidth = number;
      else if (tag === 'shad' && number !== undefined) {
        activeStyle.shadowOffsetX = number;
        activeStyle.shadowOffsetY = number;
      } else if (tag === 'fsp' && number !== undefined) activeStyle.letterSpacing = number;
      else if (tag === 'fscx' && number !== undefined) activeStyle.scaleX = number / 100;
      else if (tag === 'fscy' && number !== undefined) activeStyle.scaleY = number / 100;
      else if ((tag === 'frz' || tag === 'fr') && number !== undefined) activeStyle.rotation = number;
      else if (tag === 'an' && number !== undefined) alignment = number;
      else if (tag === 'pos') {
        const values = argument.match(/^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
        if (values) position = { x: Number(values[1]), y: Number(values[2]), coordinateSpace: 'script', alignment };
      } else if (tag === 'move') {
        const values = argument
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((part) => Number(part.trim()));
        if (values.length >= 4 && values.slice(0, 4).every(Number.isFinite)) {
          move = {
            fromX: values[0],
            fromY: values[1],
            toX: values[2],
            toY: values[3],
            startOffsetMs: values.length >= 6 && Number.isFinite(values[4]) ? values[4] : undefined,
            endOffsetMs: values.length >= 6 && Number.isFinite(values[5]) ? values[5] : undefined,
          };
        }
      } else if (tag === 'fad') {
        const values = argument.replace(/^\(|\)$/g, '').split(',').map((part) => Number(part.trim()));
        if (values.length === 2 && values.every(Number.isFinite)) fade = { inMs: values[0], outMs: values[1] };
      } else if (tag === 'k' || tag === 'kf' || tag === 'ko') {
        const duration = Number(argument);
        if (Number.isFinite(duration)) pendingKaraokeMs = Math.max(0, duration * 10);
      } else if (tag === 'r') {
        const resetStyle = argument ? styles[argument] : undefined;
        activeStyle = { ...(resetStyle ?? baseStyle) };
      } else if (['t', 'clip', 'iclip', 'org', 'p', 'pbo', 'be', 'blur', 'fade'].includes(tag)) {
        const warning = `ASS override \\${tag} is preserved in raw text but not fully rendered yet.`;
        if (!warnings.includes(warning)) warnings.push(warning);
      }
    }
  };

  const blockPattern = /\{([^}]*)\}/g;
  for (const match of raw.matchAll(blockPattern)) {
    const index = match.index ?? 0;
    appendText(raw.slice(cursor, index));
    applyBlock(match[1]);
    cursor = index + match[0].length;
  }
  appendText(raw.slice(cursor));

  return {
    text,
    spans,
    position: position ? { ...position, alignment } : alignment ? { alignment } : undefined,
    move,
    fade,
    style: activeStyle,
  };
}

function parseAss(input: string, format: 'ass' | 'ssa'): SubtitleTrack {
  const lines = normalizeInput(input).split('\n');
  const metadata: Record<string, string> = {};
  const styles: Record<string, SubtitleCueStyle> = {};
  const cues: SubtitleCue[] = [];
  const warnings: string[] = [];
  let section = '';
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }

    if (section === 'script info') {
      const separator = line.indexOf(':');
      if (separator > 0) metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      continue;
    }

    if (section === 'v4+ styles' || section === 'v4 styles') {
      if (/^format\s*:/i.test(line)) {
        styleFormat = line.slice(line.indexOf(':') + 1).split(',').map((field) => field.trim());
      } else if (/^style\s*:/i.test(line) && styleFormat.length) {
        const values = splitLimited(line.slice(line.indexOf(':') + 1), styleFormat.length);
        const fields = mapFields(styleFormat, values);
        if (fields.name) styles[fields.name] = parseAssStyle(fields);
      }
      continue;
    }

    if (section === 'events') {
      if (/^format\s*:/i.test(line)) {
        eventFormat = line.slice(line.indexOf(':') + 1).split(',').map((field) => field.trim());
        continue;
      }
      if (!/^dialogue\s*:/i.test(line) || !eventFormat.length) continue;

      const rawPayload = line.slice(line.indexOf(':') + 1);
      const fields = mapFields(eventFormat, splitLimited(rawPayload, eventFormat.length));
      const startMs = parseClockTimestamp(fields.start);
      const endMs = parseClockTimestamp(fields.end);
      const styleName = fields.style || 'Default';
      const baseStyle = styles[styleName] ?? {};
      const parsed = parseAssDialogueText(fields.text ?? '', baseStyle, styles, warnings);
      const alignment = parsed.position?.alignment ?? baseStyle.alignment;
      const marginLeft = numeric(fields.marginl) || baseStyle.marginLeft;
      const marginRight = numeric(fields.marginr) || baseStyle.marginRight;
      const marginVertical = numeric(fields.marginv) || baseStyle.marginVertical;
      const cueStyle = { ...baseStyle, ...parsed.style, alignment, marginLeft, marginRight, marginVertical };

      cues.push({
        id: `ass-${cues.length + 1}`,
        startMs,
        endMs,
        text: parsed.text,
        spans: parsed.spans,
        styleName,
        style: cueStyle,
        position: parsed.position ?? (alignment ? { alignment } : undefined),
        move: parsed.move,
        fade: parsed.fade,
        layer: numeric(fields.layer ?? fields.marked),
        actor: fields.name || undefined,
        raw: fields.text,
      });
    }
  }

  return {
    format,
    cues: cues.sort((a, b) => a.startMs - b.startMs || (a.layer ?? 0) - (b.layer ?? 0)),
    styles,
    metadata,
    scriptWidth: numeric(metadata.PlayResX),
    scriptHeight: numeric(metadata.PlayResY),
    warnings,
  };
}

function parseSrt(input: string): SubtitleTrack {
  const blocks = normalizeInput(input).trim().split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/^\s*(\S+)\s*-->\s*(\S+)/);
    if (!timing) continue;
    const raw = lines.slice(timingIndex + 1).join('\n');
    const parsed = raw.includes('{\\')
      ? parseAssDialogueText(raw, {}, {}, []).spans
      : parseHtmlishMarkup(raw).spans;
    const text = parsed.map((span) => span.text).join('');
    cues.push({
      id: lines.slice(0, timingIndex).join(' ').trim() || `srt-${cues.length + 1}`,
      startMs: parseClockTimestamp(timing[1]),
      endMs: parseClockTimestamp(timing[2]),
      text,
      spans: parsed.length ? parsed : [{ text }],
      raw,
    });
  }
  return { format: 'srt', cues };
}

function parseVtt(input: string): SubtitleTrack {
  const normalized = normalizeInput(input);
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  const metadata: Record<string, string> = {};

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.length > 0);
    if (!lines.length) continue;
    if (lines[0].startsWith('WEBVTT')) {
      if (lines[0].slice(6).trim()) metadata.header = lines[0].slice(6).trim();
      continue;
    }
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/^\s*(\S+)\s*-->\s*(\S+)(?:\s+(.*))?$/);
    if (!timing) continue;
    const raw = lines.slice(timingIndex + 1).join('\n');
    const parsed = parseHtmlishMarkup(raw);
    const settings = Object.fromEntries(
      (timing[3] ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((setting) => {
          const separator = setting.indexOf(':');
          return separator > 0 ? [setting.slice(0, separator), setting.slice(separator + 1)] : [setting, ''];
        }),
    );
    cues.push({
      id: timingIndex > 0 ? lines.slice(0, timingIndex).join(' ') : `vtt-${cues.length + 1}`,
      startMs: parseClockTimestamp(timing[1]),
      endMs: parseClockTimestamp(timing[2]),
      text: parsed.text,
      spans: parsed.spans.length ? parsed.spans : [{ text: parsed.text }],
      actor: parsed.actor,
      position: {
        coordinateSpace: 'percent',
        line: settings.line,
        position: settings.position,
        size: settings.size,
        vertical: settings.vertical,
      },
      raw,
    });
  }
  return { format: 'vtt', cues, metadata };
}

function parseSbv(input: string): SubtitleTrack {
  const blocks = normalizeInput(input).trim().split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines[0]?.match(/^\s*([^,]+),([^,]+)\s*$/);
    if (!timing) continue;
    const raw = lines.slice(1).join('\n');
    const parsed = parseHtmlishMarkup(raw);
    cues.push({
      id: `sbv-${cues.length + 1}`,
      startMs: parseClockTimestamp(timing[1]),
      endMs: parseClockTimestamp(timing[2]),
      text: parsed.text,
      spans: parsed.spans.length ? parsed.spans : [{ text: parsed.text }],
      raw,
    });
  }
  return { format: 'sbv', cues };
}

function parseLrcTimestamp(value: string) {
  const match = value.match(/^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (!match) throw new Error(`Invalid LRC timestamp: ${value}`);
  const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
  return Math.round((Number(match[1]) * 60 + Number(match[2]) + fraction) * 1000);
}

function parseLrc(input: string, defaultCueDurationMs: number): SubtitleTrack {
  const metadata: Record<string, string> = {};
  const entries: Array<{ startMs: number; text: string }> = [];
  for (const line of normalizeInput(input).split('\n')) {
    const metadataMatch = line.match(/^\[([a-z]+):([^\]]*)\]$/i);
    if (metadataMatch && !/^\d+$/.test(metadataMatch[1])) {
      metadata[metadataMatch[1]] = metadataMatch[2];
      continue;
    }
    const timestamps = [...line.matchAll(/\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!timestamps.length) continue;
    const text = line.replace(/\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\]/g, '').trim();
    for (const stamp of timestamps) entries.push({ startMs: parseLrcTimestamp(stamp[1]), text });
  }
  entries.sort((a, b) => a.startMs - b.startMs);
  const cues = entries.map((entry, index): SubtitleCue => {
    const next = entries[index + 1]?.startMs;
    const parsed = parseHtmlishMarkup(entry.text);
    return {
      id: `lrc-${index + 1}`,
      startMs: entry.startMs,
      endMs: next ?? entry.startMs + defaultCueDurationMs,
      text: parsed.text,
      spans: parsed.spans.length ? parsed.spans : [{ text: parsed.text }],
      raw: entry.text,
    };
  });
  return { format: 'lrc', cues, metadata };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(input: string): SubtitleTrack {
  const data: unknown = JSON.parse(input);
  if (isRecord(data) && Array.isArray(data.cues)) {
    return { ...(data as unknown as SubtitleTrack), format: 'json' };
  }
  if (!Array.isArray(data)) throw new Error('JSON subtitles must be a Caption[] or SubtitleTrack-like object.');
  const cues = data.map((item, index): SubtitleCue => {
    if (!isRecord(item)) throw new Error(`Invalid JSON subtitle item at index ${index}.`);
    const text = String(item.text ?? '');
    const startMs = Number(item.startMs ?? item.start ?? 0);
    const endMs = Number(item.endMs ?? item.end ?? startMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error(`Invalid JSON subtitle timing at index ${index}.`);
    }
    return { id: `json-${index + 1}`, startMs, endMs, text, spans: [{ text }] };
  });
  return { format: 'json', cues };
}

export function detectSubtitleFormat(input: string, fileName?: string): SubtitleFormat {
  const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1];
  if (extension && ['srt', 'vtt', 'ass', 'ssa', 'lrc', 'sbv', 'json'].includes(extension)) {
    return extension as SubtitleFormat;
  }

  const normalized = normalizeInput(input).trimStart();
  if (normalized.startsWith('WEBVTT')) return 'vtt';
  if (/^\s*\[(script info|v4\+? styles|events)\]/im.test(normalized)) {
    return /ScriptType\s*:\s*v4\.00\+/i.test(normalized) ? 'ass' : 'ssa';
  }
  if (/^\s*[\[{]/.test(normalized)) {
    try {
      JSON.parse(normalized);
      return 'json';
    } catch {
      // Continue format detection.
    }
  }
  if (/^\s*\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(normalized)) return 'lrc';
  if (/^\s*\d+:\d{2}:\d{2}[.,]\d+\s*,\s*\d+:\d{2}:\d{2}[.,]\d+/m.test(normalized)) return 'sbv';
  if (/-->/.test(normalized)) return /^WEBVTT/m.test(normalized) || /\d{2}:\d{2}\.\d{3}/.test(normalized) ? 'vtt' : 'srt';
  throw new Error('Unable to detect subtitle format. Pass format explicitly or provide a recognized fileName.');
}

export function parseSubtitleText({
  input,
  format = 'auto',
  fileName,
  defaultCueDurationMs = 3000,
}: ParseSubtitleInput): SubtitleTrack {
  const resolved = format === 'auto' ? detectSubtitleFormat(input, fileName) : format;
  switch (resolved) {
    case 'srt':
      return parseSrt(input);
    case 'vtt':
      return parseVtt(input);
    case 'ass':
    case 'ssa':
      return parseAss(input, resolved);
    case 'lrc':
      return parseLrc(input, defaultCueDurationMs);
    case 'sbv':
      return parseSbv(input);
    case 'json':
      return parseJson(input);
  }
}
