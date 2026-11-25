// Simple Store-method (uncompressed) ZIP builder for in-memory files and images

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function calculateCrc32(bytes: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

export type ZipInputEntry = {
  name: string;
  blob: Blob;
};

export async function createZipFromBlobs(entries: ZipInputEntry[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const centralDirectoryHeaders: Uint8Array[] = [];

  let currentOffset = 0;

  for (const entry of entries) {
    const fileBytes = new Uint8Array(await entry.blob.arrayBuffer());
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = calculateCrc32(fileBytes);
    const size = fileBytes.byteLength;

    // Local file header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lView = new DataView(localHeader.buffer);

    lView.setUint32(0, 0x04034b50, true); // signature
    lView.setUint16(4, 20, true); // version needed to extract (2.0)
    lView.setUint16(6, 0, true); // general purpose bit flag
    lView.setUint16(8, 0, true); // compression method (0 = store)
    lView.setUint16(10, 0, true); // last mod file time
    lView.setUint16(12, 0, true); // last mod file date
    lView.setUint32(14, crc, true); // crc-32
    lView.setUint32(18, size, true); // compressed size
    lView.setUint32(22, size, true); // uncompressed size
    lView.setUint16(26, nameBytes.length, true); // file name length
    lView.setUint16(28, 0, true); // extra field length

    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(fileBytes);

    // Central directory header (46 bytes + name)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cView = new DataView(cdHeader.buffer);

    cView.setUint32(0, 0x02014b50, true); // signature
    cView.setUint16(4, 20, true); // version made by
    cView.setUint16(6, 20, true); // version needed to extract
    cView.setUint16(8, 0, true); // bit flag
    cView.setUint16(10, 0, true); // compression method
    cView.setUint16(12, 0, true); // time
    cView.setUint16(14, 0, true); // date
    cView.setUint32(16, crc, true); // crc-32
    cView.setUint32(20, size, true); // compressed size
    cView.setUint32(24, size, true); // uncompressed size
    cView.setUint16(28, nameBytes.length, true); // name length
    cView.setUint16(30, 0, true); // extra field len
    cView.setUint16(32, 0, true); // comment len
    cView.setUint16(34, 0, true); // disk number start
    cView.setUint16(36, 0, true); // internal file attributes
    cView.setUint32(38, 0, true); // external file attributes
    cView.setUint32(42, currentOffset, true); // relative offset of local header

    cdHeader.set(nameBytes, 46);
    centralDirectoryHeaders.push(cdHeader);

    currentOffset += localHeader.byteLength + fileBytes.byteLength;
  }

  const centralDirectoryOffset = currentOffset;
  let centralDirectorySize = 0;
  for (const cdh of centralDirectoryHeaders) {
    centralDirectorySize += cdh.byteLength;
    parts.push(cdh);
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);

  eView.setUint32(0, 0x06054b50, true); // signature
  eView.setUint16(4, 0, true); // disk number
  eView.setUint16(6, 0, true); // disk where central dir starts
  eView.setUint16(8, entries.length, true); // number of central dir records on this disk
  eView.setUint16(10, entries.length, true); // total number of central dir records
  eView.setUint32(12, centralDirectorySize, true); // size of central dir
  eView.setUint32(16, centralDirectoryOffset, true); // offset of central dir
  eView.setUint16(20, 0, true); // comment length

  parts.push(eocd);

  return new Blob(parts as BlobPart[], { type: "application/zip" });
}
