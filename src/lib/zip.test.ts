import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { readZipEntry } from './zip';

interface Member {
    name: string;
    data: Buffer;
    method?: number;
    crc?: number;
}

// Sizes of the pieces the builder writes after each central header, so a test can find the one it wants to damage.
const END_RECORD = 22;
const CENTRAL_HEADER = 46;
const CENTRAL_EXTRA = 2;
const CENTRAL_COMMENT = 'abc';
const FIRST_CENTRAL_FROM_END = END_RECORD + CENTRAL_HEADER + 'a.txt'.length + CENTRAL_EXTRA + CENTRAL_COMMENT.length;

// Builds a zip the way zip tools do: local headers with the data, then the central directory, then the end record.
function buildZip(members: Member[], comment = ''): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const { name, data, method = 8, crc = crc32(data) } of members) {
        const body = method === 8 ? deflateRawSync(data) : data;
        const nameBytes = Buffer.from(name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        // An extra field, to prove the data start accounts for it.
        local.writeUInt16LE(4, 28);
        locals.push(local, nameBytes, Buffer.alloc(4), body);

        const central = Buffer.alloc(CENTRAL_HEADER);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt16LE(CENTRAL_EXTRA, 30);
        central.writeUInt16LE(CENTRAL_COMMENT.length, 32);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBytes, Buffer.alloc(CENTRAL_EXTRA), Buffer.from(CENTRAL_COMMENT));
        offset += 30 + nameBytes.length + 4 + body.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(END_RECORD);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(members.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(Buffer.byteLength(comment), 20);
    return Buffer.concat([...locals, directory, end, Buffer.from(comment)]);
}

const TEXT = Buffer.from('1\tLisbon\n'.repeat(500));

// A single-entry zip and the offset of its central header, for the tests that corrupt one field.
function singleEntry(method = 8): { zip: Buffer; central: number } {
    const zip = buildZip([{ name: 'a.txt', data: TEXT, method }]);
    return { zip, central: zip.length - FIRST_CENTRAL_FROM_END };
}

describe('readZipEntry', () => {
    it('inflates a deflated entry', () => {
        expect(readZipEntry(singleEntry().zip, 'a.txt')).toEqual(TEXT);
    });

    it('reads a stored entry', () => {
        expect(readZipEntry(singleEntry(0).zip, 'a.txt')).toEqual(TEXT);
    });

    it('finds the named entry among several, past an archive comment', () => {
        const zip = buildZip(
            [
                { name: 'readme.txt', data: Buffer.from('hello') },
                { name: 'cities1000.txt', data: TEXT },
            ],
            'archive comment',
        );
        expect(readZipEntry(zip, 'cities1000.txt')).toEqual(TEXT);
    });

    it('throws when the entry is not there', () => {
        expect(() => readZipEntry(singleEntry().zip, 'b.txt')).toThrow(/b\.txt is not in the zip/);
    });

    it('throws for data that is not a zip, including one too short to hold an end record', () => {
        expect(() => readZipEntry(Buffer.from('not a zip at all, just text'), 'a.txt')).toThrow(/Not a zip archive/);
        expect(() => readZipEntry(Buffer.alloc(3), 'a.txt')).toThrow(/Not a zip archive/);
    });

    it('throws when the CRC-32 or the size does not match', () => {
        expect(() => readZipEntry(buildZip([{ name: 'a.txt', data: TEXT, crc: 1 }]), 'a.txt')).toThrow(/corrupt/);
        const { zip, central } = singleEntry(0);
        zip.writeUInt32LE(TEXT.length + 1, central + 24);
        expect(() => readZipEntry(zip, 'a.txt')).toThrow(/corrupt/);
    });

    it('throws for an unsupported compression method', () => {
        const { zip, central } = singleEntry(0);
        zip.writeUInt16LE(12, central + 10);
        expect(() => readZipEntry(zip, 'a.txt')).toThrow(/Unsupported zip compression method 12/);
    });

    it('throws for a damaged central directory or local header', () => {
        const brokenCentral = singleEntry();
        brokenCentral.zip.writeUInt32LE(0, brokenCentral.central);
        expect(() => readZipEntry(brokenCentral.zip, 'a.txt')).toThrow(/central directory/);
        const brokenLocal = singleEntry();
        brokenLocal.zip.writeUInt32LE(0, 0);
        expect(() => readZipEntry(brokenLocal.zip, 'a.txt')).toThrow(/local file header/);
    });

    it('refuses zip64 archives and entries, and entries larger than the ceiling', () => {
        const zip64Archive = singleEntry();
        zip64Archive.zip.writeUInt32LE(0xffffffff, zip64Archive.zip.length - END_RECORD + 16);
        expect(() => readZipEntry(zip64Archive.zip, 'a.txt')).toThrow(/Zip64 archives/);
        const zip64Entry = singleEntry();
        zip64Entry.zip.writeUInt32LE(0xffffffff, zip64Entry.central + 24);
        expect(() => readZipEntry(zip64Entry.zip, 'a.txt')).toThrow(/Zip64 entries/);
        const huge = singleEntry();
        huge.zip.writeUInt32LE(0xfffffffe, huge.central + 24);
        expect(() => readZipEntry(huge.zip, 'a.txt')).toThrow(/larger than/);
    });
});
