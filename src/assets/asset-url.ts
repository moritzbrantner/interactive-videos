// The served, content-addressed path of an asset object, relative to the app's base URL (Pages)
// or the render bundle's public directory. The same digest always yields the same path.
export const ASSET_URL_PREFIX = 'assets/sha256/';

export function assetPath(sha256: string): string {
  return `${ASSET_URL_PREFIX}${sha256}`;
}
