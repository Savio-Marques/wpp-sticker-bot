declare module 'node-webpmux' {
  export interface WebPImage {
    readonly width: number;
    readonly height: number;
    readonly hasAnim: boolean;
    readonly hasAlpha: boolean;
    readonly frameCount: number;
    exif?: Buffer;
    load(source: string | Buffer): Promise<void>;
    save(path?: string | null, options?: Record<string, unknown>): Promise<Buffer>;
  }

  export const Image: {
    new (): WebPImage;
  };

  const WebP: {
    Image: typeof Image;
  };

  export default WebP;
}
