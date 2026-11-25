declare module "pdfjs-dist/image_decoders/pdf.image_decoders.mjs" {
  export interface JpegDecoderInstance {
    width: number;
    height: number;
    numComponents: number;
    parse(data: Uint8Array): void;
    getData(options: { width: number; height: number; forceRGB?: boolean }): Uint8Array;
  }

  export interface JpegDecoderConstructor {
    new (): JpegDecoderInstance;
  }

  export const JpegImage: JpegDecoderConstructor;
}

