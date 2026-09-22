import { environment } from '../../../environments/environment';

const apiBaseUrl = (environment.apiUrl ?? '').replace(/\/+$/, '');
const apiOrigin = apiBaseUrl.replace(/\/api$/i, '');
let assetAccessToken: string | null = null;

export const FALLBACK_IMAGE_URL =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1200 800%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%231d3557%22/%3E%3Cstop offset=%221%22 stop-color=%22%232a9d8f%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%221200%22 height=%22800%22 fill=%22url(%23g)%22/%3E%3Cpath d=%22M0 560 240 390l160 100 210-220 230 250 160-120 200 150v250H0Z%22 fill=%22%23ffffff%22 opacity=%22.22%22/%3E%3Ccircle cx=%22920%22 cy=%22170%22 r=%2280%22 fill=%22%23ffffff%22 opacity=%22.28%22/%3E%3C/svg%3E';

export function buildApiUrl(path = ''): string {
  const normalizedPath = path.replace(/^\/+/, '');

  if (!normalizedPath) {
    return apiBaseUrl;
  }

  return `${apiBaseUrl}/${normalizedPath}`;
}

export function setAssetAccessToken(token: string | null): void {
  assetAccessToken = token;
}

export function buildAssetUrl(path?: string | null): string | null {
  if (!path) {
    return null;
  }

  const normalizedPath = path.trim().replace(/\\/g, '/');

  if (!normalizedPath) {
    return null;
  }

  if (/^(https?:|data:|blob:)/i.test(normalizedPath)) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith('assets/')) {
    return normalizedPath;
  }

  const tokenSuffix = assetAccessToken ? `?access_token=${encodeURIComponent(assetAccessToken)}` : '';

  const relativePrivateImagePath = extractPrivateImagePath(normalizedPath);
  if (relativePrivateImagePath) {
    return buildPrivateImageUrl(relativePrivateImagePath, tokenSuffix);
  }

  if (normalizedPath.startsWith('/api/images/')) {
    return `${apiOrigin}${normalizedPath}${tokenSuffix}`;
  }

  if (normalizedPath.startsWith('/')) {
    return `${apiOrigin}${normalizedPath}`;
  }

  return buildPrivateImageUrl(normalizedPath, tokenSuffix);
}

export interface AssetImageSource {
  imageUrl?: string | null;
  imageUrls?: readonly (string | null | undefined)[] | null;
}

export function buildAssetUrls(source?: AssetImageSource | null): string[] {
  if (!source) {
    return [];
  }

  const candidates = [
    ...splitImageValue(source.imageUrl),
    ...(source.imageUrls ?? []).flatMap((url) => splitImageValue(url)),
  ];

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const candidate of candidates) {
    const url = buildAssetUrl(candidate);
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export function firstAssetUrl(source?: AssetImageSource | null): string | null {
  return buildAssetUrls(source)[0] ?? null;
}

function splitImageValue(value?: string | null): string[] {
  return (value ?? '')
    .split('|')
    .map((url) => url.trim())
    .filter(Boolean);
}

function extractPrivateImagePath(path: string): string | null {
  const match = path.match(/(?:^|\/)(destinations|tourist-objects|activities|events|avatars)\/([^?#]+)$/i);
  if (!match) {
    return null;
  }

  return `${match[1].toLowerCase()}/${match[2]}`;
}

function buildPrivateImageUrl(path: string, tokenSuffix: string): string {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${apiBaseUrl}/images/${encodedPath}${tokenSuffix}`;
}
