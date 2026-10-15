// The served, content-addressed path of an asset object, relative to the app's base URL (Pages)
// or the render bundle's public directory. The same digest always yields the same path; the
// extension follows the declared media type so static hosts serve the right Content-Type.
export const ASSET_URL_PREFIX = 'assets/sha256/';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/json': 'json',
};

/** File extension for a media type; `bin` for types without a known one. */
export function assetExtension(mediaType: string): string {
  return EXTENSIONS[mediaType] ?? 'bin';
}

export function assetPath(sha256: string, mediaType: string): string {
  return `${ASSET_URL_PREFIX}${sha256}.${assetExtension(mediaType)}`;
}
