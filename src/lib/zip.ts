import { crc32, inflateRawSync } from 'node:zlib';

// A minimal zip reader for one job: pulling a single text file out of the archive GeoNames publishes
// (https://download.geonames.org/export/dump/cities1000.zip). It reads the central directory (the authoritative index,
// so data descriptors are no problem), supports the two methods zip tools use for ordinary files (stored and
// deflate), and checks the size and CRC-32 of what it extracts. It exists so the sync needs no zip dependency, which
// would also mean an `npm install` on Windows that rewrites the lockfile (see AGENTS.md, "Known gaps").

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
// The end record is 22 bytes plus a comment of at most 65,535 bytes.
const MAX_END_RECORD_SEARCH = 22 + 0xffff;
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
// A ceiling on what a hostile or corrupt archive may inflate to; cities1000.txt is about 32 MB.
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

function findEndRecord(zip: Buffer): number {
    const lowest = Math.max(0, zip.length - MAX_END_RECORD_SEARCH);
    for (let offset = zip.length - 22; offset >= lowest; offset--) {
        if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
    }
    throw new Error('Not a zip archive: no end-of-central-directory record.');
}

/** The bytes of the file called `name` in the zip archive `zip`. Throws if it is absent, unsupported or corrupt. */
export function readZipEntry(zip: Buffer, name: string): Buffer {
    const end = findEndRecord(zip);
    const entryCount = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    if (offset === ZIP64_MARKER) throw new Error('Zip64 archives are not supported.');

    for (let index = 0; index < entryCount; index++) {
        if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) throw new Error('Corrupt zip central directory.');
        const method = zip.readUInt16LE(offset + 10);
        const crc = zip.readUInt32LE(offset + 16);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const size = zip.readUInt32LE(offset + 24);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const entryName = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (entryName !== name) continue;

        if (size === ZIP64_MARKER || compressedSize === ZIP64_MARKER)
            throw new Error('Zip64 entries are not supported.');
        if (size > MAX_ENTRY_BYTES) throw new Error(`${name} is larger than ${MAX_ENTRY_BYTES} bytes.`);
        if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error('Corrupt zip local file header.');
        const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        const compressed = zip.subarray(dataStart, dataStart + compressedSize);

        let data: Buffer;
        if (method === METHOD_STORED) {
            data = compressed;
        } else if (method === METHOD_DEFLATE) {
            data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
        } else {
            throw new Error(`Unsupported zip compression method ${method}.`);
        }
        if (data.length !== size || crc32(data) !== crc)
            throw new Error(`${name} is corrupt (size or CRC-32 mismatch).`);
        return data;
    }
    throw new Error(`${name} is not in the zip archive.`);
}
