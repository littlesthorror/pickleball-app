// Minimal, dependency-free ZIP archive writer (2026-09-07) — store method
// only (no compression). Written to support the "Save fixtures as Word
// doc" export: a .docx file is just a ZIP archive of a handful of small
// XML parts, and this sandbox has no npm registry access to pull in a zip
// library (or a docx-generation one). ZIP doesn't require compression —
// "store" is a fully valid, spec-compliant method — so a from-scratch
// writer is a few dozen lines, not a project. Not intended as a general
// zip tool: no directories, no streaming, no compression, entries capped
// well under 4GB (fine for a text-only document).

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function dosDateTime(): { date: number; time: number } {
  const now = new Date();
  const date = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2) & 0x1f);
  return { date, time };
}

function writeUint16LE(arr: number[], v: number) {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}
function writeUint32LE(arr: number[], v: number) {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

export function buildZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime();
  const chunks: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const entryOffset = offset;

    const local: number[] = [];
    writeUint32LE(local, 0x04034b50); // local file header signature
    writeUint16LE(local, 20); // version needed to extract
    writeUint16LE(local, 0); // general purpose flag
    writeUint16LE(local, 0); // compression method: 0 = store
    writeUint16LE(local, time);
    writeUint16LE(local, date);
    writeUint32LE(local, crc);
    writeUint32LE(local, data.length); // compressed size
    writeUint32LE(local, data.length); // uncompressed size
    writeUint16LE(local, nameBytes.length);
    writeUint16LE(local, 0); // extra field length
    const localHeader = new Uint8Array(local);
    chunks.push(localHeader, nameBytes, data);

    writeUint32LE(central, 0x02014b50); // central directory header signature
    writeUint16LE(central, 20); // version made by
    writeUint16LE(central, 20); // version needed to extract
    writeUint16LE(central, 0); // general purpose flag
    writeUint16LE(central, 0); // compression method
    writeUint16LE(central, time);
    writeUint16LE(central, date);
    writeUint32LE(central, crc);
    writeUint32LE(central, data.length);
    writeUint32LE(central, data.length);
    writeUint16LE(central, nameBytes.length);
    writeUint16LE(central, 0); // extra field length
    writeUint16LE(central, 0); // comment length
    writeUint16LE(central, 0); // disk number start
    writeUint16LE(central, 0); // internal file attributes
    writeUint32LE(central, 0); // external file attributes
    writeUint32LE(central, entryOffset); // relative offset of local header
    for (const b of nameBytes) central.push(b);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  const centralBytes = new Uint8Array(central);
  chunks.push(centralBytes);
  offset += centralBytes.length;

  const end: number[] = [];
  writeUint32LE(end, 0x06054b50); // end of central directory signature
  writeUint16LE(end, 0); // disk number
  writeUint16LE(end, 0); // disk with central directory
  writeUint16LE(end, entries.length); // entries on this disk
  writeUint16LE(end, entries.length); // total entries
  writeUint32LE(end, centralBytes.length); // central directory size
  writeUint32LE(end, centralStart); // central directory offset
  writeUint16LE(end, 0); // comment length
  chunks.push(new Uint8Array(end));

  return new Blob(chunks as BlobPart[], { type: "application/zip" });
}
