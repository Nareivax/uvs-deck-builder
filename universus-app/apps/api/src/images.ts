import { config } from './config.ts';

export type ImageVariant = 'mini' | 'preview' | 'full';

/** Public URL of a card image, or null if the card has none. */
export function imageUrl(key: string | null, variant: ImageVariant = 'mini'): string | null {
  if (!key) return null;
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${config.imageBaseUrl}/${path}${variant === 'full' ? '' : `-${variant}`}.jpg`;
}
