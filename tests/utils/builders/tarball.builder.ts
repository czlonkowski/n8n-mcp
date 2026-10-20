import { gzipSync } from 'zlib';

/** Builds one ustar entry: a 512-byte header followed by the content padded to a 512-byte boundary. */
export function tarEntry(name: string, content: string, typeflag = '0'): Buffer {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write(typeflag, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

/** A pax extended header whose `path` record renames the entry that follows it. */
export function paxPathEntry(path: string): Buffer {
  const body = ` path=${path}\n`;
  // Record lengths count bytes, so a non-ASCII path is measured in UTF-8.
  const recordLength = (length: number) => Buffer.byteLength(`${length}${body}`);
  let length = Buffer.byteLength(body) + 1;
  while (recordLength(length) !== length) length = recordLength(length);
  return tarEntry('PaxHeader/entry', `${length}${body}`, 'x');
}

/** Gzips the entries followed by the two zero blocks that end a tar archive, like an npm tarball. */
export function tgz(...entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}
