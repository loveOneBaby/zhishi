export const MOBILE_HOME_HASH = '#/mobile/home';
export const DESKTOP_HOME_HASH = '#/library';

export function isRootHash(hash: string): boolean {
  return hash === '' || hash === '#' || hash === '#/';
}

export function defaultHashForDevice(isMobile: boolean): string {
  return isMobile ? MOBILE_HOME_HASH : DESKTOP_HOME_HASH;
}

export function detectMobileDevice(viewportWidth: number, coarsePointer: boolean, userAgent: string): boolean {
  const mobileUserAgent = /Android|iPhone|iPod|Mobile|Windows Phone/i.test(userAgent);
  return viewportWidth <= 768 || mobileUserAgent || (coarsePointer && viewportWidth <= 1024);
}
