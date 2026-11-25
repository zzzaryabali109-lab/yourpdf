/**
 * Self-contained ITU-T T.81 / ISO 10918-1 compliant baseline JPEG encoder.
 * Fast, pure TypeScript, zero native or external dependencies.
 */

const STD_Y_QTABLE = new Uint8Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
]);

const STD_C_QTABLE = new Uint8Array([
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
]);

const ZIGZAG = new Uint8Array([
   0,  1,  8, 16,  9,  2,  3, 10,
  17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
]);

const STD_DC_LUM_NRCODES = new Uint8Array([0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
const STD_DC_LUM_VALUES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const STD_DC_CHROM_NRCODES = new Uint8Array([0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const STD_DC_CHROM_VALUES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const STD_AC_LUM_NRCODES = new Uint8Array([0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]);
const STD_AC_LUM_VALUES = new Uint8Array([
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12,
  0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79,
  0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
  0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
  0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);

const STD_AC_CHROM_NRCODES = new Uint8Array([0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]);
const STD_AC_CHROM_VALUES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21,
  0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
  0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
  0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
  0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
  0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
  0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]);

type HuffmanEntry = { code: number; length: number };

function buildHuffmanTable(nrCodes: Uint8Array, values: Uint8Array): Map<number, HuffmanEntry> {
  const huffcode: number[] = [];
  const huffsize: number[] = [];
  let k = 0;
  let code = 0;

  for (let l = 1; l <= 16; l++) {
    for (let i = 1; i <= nrCodes[l]; i++) {
      huffsize[k] = l;
      huffcode[k] = code;
      code++;
      k++;
    }
    code <<= 1;
  }

  const table = new Map<number, HuffmanEntry>();
  for (let i = 0; i < k; i++) {
    table.set(values[i], { code: huffcode[i], length: huffsize[i] });
  }
  return table;
}

function computeQuantTable(stdTable: Uint8Array, quality: number): Uint8Array {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : Math.floor(200 - q * 2);
  const qtable = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    let val = Math.floor((stdTable[i] * scale + 50) / 100);
    if (val < 1) val = 1;
    if (val > 255) val = 255;
    qtable[i] = val;
  }
  return qtable;
}

class BitWriter {
  private buffer: Uint8Array;
  private length = 0;
  private currentByte = 0;
  private bitsLeft = 8;

  constructor(initialCapacity = 65536) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  private ensureCapacity(additional: number) {
    if (this.length + additional > this.buffer.length) {
      const newBuf = new Uint8Array(Math.max(this.buffer.length * 2, this.length + additional + 4096));
      newBuf.set(this.buffer);
      this.buffer = newBuf;
    }
  }

  writeByte(b: number) {
    this.ensureCapacity(1);
    this.buffer[this.length++] = b & 0xff;
  }

  writeBytes(bytes: Uint8Array) {
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  writeBits(code: number, length: number) {
    let c = code;
    let l = length;
    while (l > 0) {
      if (l <= this.bitsLeft) {
        this.currentByte |= (c & ((1 << l) - 1)) << (this.bitsLeft - l);
        this.bitsLeft -= l;
        if (this.bitsLeft === 0) {
          this.writeByte(this.currentByte);
          if (this.currentByte === 0xff) this.writeByte(0x00);
          this.currentByte = 0;
          this.bitsLeft = 8;
        }
        break;
      } else {
        const shift = l - this.bitsLeft;
        this.currentByte |= (c >> shift) & ((1 << this.bitsLeft) - 1);
        l -= this.bitsLeft;
        c &= (1 << l) - 1;
        this.writeByte(this.currentByte);
        if (this.currentByte === 0xff) this.writeByte(0x00);
        this.currentByte = 0;
        this.bitsLeft = 8;
      }
    }
  }

  flushBits() {
    if (this.bitsLeft < 8) {
      this.currentByte |= (1 << this.bitsLeft) - 1;
      this.writeByte(this.currentByte);
      if (this.currentByte === 0xff) this.writeByte(0x00);
      this.currentByte = 0;
      this.bitsLeft = 8;
    }
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buffer.subarray(0, this.length));
  }
}

const C = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  const alpha = u === 0 ? 1 / Math.SQRT2 : 1.0;
  for (let x = 0; x < 8; x++) {
    C[u * 8 + x] = 0.5 * alpha * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

function forwardDct(block: Float64Array, outDct: Float64Array) {
  const temp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        sum += C[u * 8 + x] * block[y * 8 + x];
      }
      temp[y * 8 + u] = sum;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) {
        sum += C[v * 8 + y] * temp[y * 8 + u];
      }
      outDct[v * 8 + u] = sum;
    }
  }
}

const CATEGORY_MAP = new Uint8Array(4096);
const CODE_MAP = new Int32Array(4096);
for (let val = -2048; val <= 2047; val++) {
  const idx = val + 2048;
  if (val === 0) {
    CATEGORY_MAP[idx] = 0;
    CODE_MAP[idx] = 0;
  } else {
    const absVal = Math.abs(val);
    let cat = 0;
    let temp = absVal;
    while (temp > 0) {
      cat++;
      temp >>= 1;
    }
    CATEGORY_MAP[idx] = cat;
    CODE_MAP[idx] = val < 0 ? (1 << cat) - 1 + val : val;
  }
}

function encodeBlock(
  dct: Float64Array,
  quantTable: Uint8Array,
  prevDc: number,
  dcTable: Map<number, HuffmanEntry>,
  acTable: Map<number, HuffmanEntry>,
  writer: BitWriter,
): number {
  const quantized = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    quantized[i] = Math.round(dct[i] / quantTable[i]);
  }

  const zz = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    zz[i] = quantized[ZIGZAG[i]];
  }

  const dcDiff = zz[0] - prevDc;
  const dcIndex = Math.max(0, Math.min(4095, dcDiff + 2048));
  const dcCat = CATEGORY_MAP[dcIndex];
  const dcHuff = dcTable.get(dcCat);
  if (!dcHuff) throw new Error("Missing DC Huffman entry");
  writer.writeBits(dcHuff.code, dcHuff.length);
  if (dcCat > 0) {
    writer.writeBits(CODE_MAP[dcIndex], dcCat);
  }

  let zeroCount = 0;
  for (let k = 1; k < 64; k++) {
    const val = zz[k];
    if (val === 0) {
      zeroCount++;
    } else {
      while (zeroCount >= 16) {
        const huff16 = acTable.get(0xf0);
        if (huff16) writer.writeBits(huff16.code, huff16.length);
        zeroCount -= 16;
      }
      const acIndex = Math.max(0, Math.min(4095, val + 2048));
      const acCat = CATEGORY_MAP[acIndex];
      const symbol = (zeroCount << 4) | acCat;
      const huff = acTable.get(symbol);
      if (!huff) throw new Error("Missing AC Huffman entry");
      writer.writeBits(huff.code, huff.length);
      writer.writeBits(CODE_MAP[acIndex], acCat);
      zeroCount = 0;
    }
  }
  if (zeroCount > 0) {
    const eob = acTable.get(0x00);
    if (eob) writer.writeBits(eob.code, eob.length);
  }

  return zz[0];
}

const dcLumTable = buildHuffmanTable(STD_DC_LUM_NRCODES, STD_DC_LUM_VALUES);
const dcChromTable = buildHuffmanTable(STD_DC_CHROM_NRCODES, STD_DC_CHROM_VALUES);
const acLumTable = buildHuffmanTable(STD_AC_LUM_NRCODES, STD_AC_LUM_VALUES);
const acChromTable = buildHuffmanTable(STD_AC_CHROM_NRCODES, STD_AC_CHROM_VALUES);

/**
 * Encodes RGB, RGBA, or Grayscale pixels into a valid standard JPEG Buffer
 */
export function encodeJpeg(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  quality = 55,
  isGrayscale = false,
): Buffer {
  const yQuant = computeQuantTable(STD_Y_QTABLE, quality);
  const cQuant = computeQuantTable(STD_C_QTABLE, quality);

  const writer = new BitWriter(Math.max(4096, Math.floor((width * height) / 4)));

  // SOI
  writer.writeBytes(new Uint8Array([0xff, 0xd8]));

  // APP0 (JFIF)
  writer.writeBytes(new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]));

  // DQT Luminance
  writer.writeBytes(new Uint8Array([0xff, 0xdb, 0x00, 0x43, 0x00]));
  const yQuantZigzag = new Uint8Array(64);
  for (let i = 0; i < 64; i++) yQuantZigzag[i] = yQuant[ZIGZAG[i]];
  writer.writeBytes(yQuantZigzag);

  if (!isGrayscale) {
    // DQT Chrominance
    writer.writeBytes(new Uint8Array([0xff, 0xdb, 0x00, 0x43, 0x01]));
    const cQuantZigzag = new Uint8Array(64);
    for (let i = 0; i < 64; i++) cQuantZigzag[i] = cQuant[ZIGZAG[i]];
    writer.writeBytes(cQuantZigzag);
  }

  // SOF0 (Baseline DCT)
  const sofLen = isGrayscale ? 11 : 17;
  writer.writeBytes(new Uint8Array([
    0xff, 0xc0,
    (sofLen >> 8) & 0xff, sofLen & 0xff,
    8,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    isGrayscale ? 1 : 3,
  ]));

  if (isGrayscale) {
    writer.writeBytes(new Uint8Array([1, 0x11, 0x00]));
  } else {
    writer.writeBytes(new Uint8Array([
      1, 0x11, 0x00,
      2, 0x11, 0x01,
      3, 0x11, 0x01,
    ]));
  }

  // DHT Tables
  function writeDht(tableType: number, id: number, nrCodes: Uint8Array, values: Uint8Array) {
    const len = 3 + 16 + values.length;
    writer.writeBytes(new Uint8Array([
      0xff, 0xc4,
      (len >> 8) & 0xff, len & 0xff,
      ((tableType & 1) << 4) | (id & 0x0f),
    ]));
    writer.writeBytes(nrCodes.subarray(1, 17));
    writer.writeBytes(values);
  }

  writeDht(0, 0, STD_DC_LUM_NRCODES, STD_DC_LUM_VALUES);
  writeDht(1, 0, STD_AC_LUM_NRCODES, STD_AC_LUM_VALUES);
  if (!isGrayscale) {
    writeDht(0, 1, STD_DC_CHROM_NRCODES, STD_DC_CHROM_VALUES);
    writeDht(1, 1, STD_AC_CHROM_NRCODES, STD_AC_CHROM_VALUES);
  }

  // SOS Scan Header
  const sosLen = isGrayscale ? 8 : 12;
  writer.writeBytes(new Uint8Array([
    0xff, 0xda,
    (sosLen >> 8) & 0xff, sosLen & 0xff,
    isGrayscale ? 1 : 3,
  ]));

  if (isGrayscale) {
    writer.writeBytes(new Uint8Array([1, 0x00]));
  } else {
    writer.writeBytes(new Uint8Array([
      1, 0x00,
      2, 0x11,
      3, 0x11,
    ]));
  }
  writer.writeBytes(new Uint8Array([0x00, 0x3f, 0x00]));

  const paddedW = Math.ceil(width / 8) * 8;
  const paddedH = Math.ceil(height / 8) * 8;
  const yPlane = new Float32Array(paddedW * paddedH);
  const cbPlane = isGrayscale ? null : new Float32Array(paddedW * paddedH);
  const crPlane = isGrayscale ? null : new Float32Array(paddedW * paddedH);

  const channels = isGrayscale ? 1 : 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      const dstIdx = y * paddedW + x;
      if (isGrayscale) {
        yPlane[dstIdx] = pixels[srcIdx] - 128;
      } else {
        const r = pixels[srcIdx];
        const g = pixels[srcIdx + 1];
        const b = pixels[srcIdx + 2];
        yPlane[dstIdx] = (0.299 * r + 0.587 * g + 0.114 * b) - 128;
        if (cbPlane && crPlane) {
          cbPlane[dstIdx] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          crPlane[dstIdx] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
    }
    for (let x = width; x < paddedW; x++) {
      const edgeIdx = y * paddedW + (width - 1);
      const dstIdx = y * paddedW + x;
      yPlane[dstIdx] = yPlane[edgeIdx];
      if (cbPlane && crPlane) {
        cbPlane[dstIdx] = cbPlane[edgeIdx];
        crPlane[dstIdx] = crPlane[edgeIdx];
      }
    }
  }

  for (let y = height; y < paddedH; y++) {
    for (let x = 0; x < paddedW; x++) {
      const edgeIdx = (height - 1) * paddedW + x;
      const dstIdx = y * paddedW + x;
      yPlane[dstIdx] = yPlane[edgeIdx];
      if (cbPlane && crPlane) {
        cbPlane[dstIdx] = cbPlane[edgeIdx];
        crPlane[dstIdx] = crPlane[edgeIdx];
      }
    }
  }

  let prevDcY = 0;
  let prevDcCb = 0;
  let prevDcCr = 0;
  const block = new Float64Array(64);
  const dct = new Float64Array(64);

  for (let by = 0; by < paddedH; by += 8) {
    for (let bx = 0; bx < paddedW; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = (by + y) * paddedW + bx;
        for (let x = 0; x < 8; x++) {
          block[y * 8 + x] = yPlane[row + x];
        }
      }
      forwardDct(block, dct);
      prevDcY = encodeBlock(dct, yQuant, prevDcY, dcLumTable, acLumTable, writer);

      if (!isGrayscale && cbPlane && crPlane) {
        for (let y = 0; y < 8; y++) {
          const row = (by + y) * paddedW + bx;
          for (let x = 0; x < 8; x++) {
            block[y * 8 + x] = cbPlane[row + x];
          }
        }
        forwardDct(block, dct);
        prevDcCb = encodeBlock(dct, cQuant, prevDcCb, dcChromTable, acChromTable, writer);

        for (let y = 0; y < 8; y++) {
          const row = (by + y) * paddedW + bx;
          for (let x = 0; x < 8; x++) {
            block[y * 8 + x] = crPlane[row + x];
          }
        }
        forwardDct(block, dct);
        prevDcCr = encodeBlock(dct, cQuant, prevDcCr, dcChromTable, acChromTable, writer);
      }
    }
  }

  writer.flushBits();
  writer.writeBytes(new Uint8Array([0xff, 0xd9]));

  return writer.toBuffer();
}

