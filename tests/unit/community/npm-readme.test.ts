import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { extractReadmeFromTarball, normalizeRegistryReadme } from '@/community/npm-readme';
import { paxPathEntry, tarEntry, tgz } from '../../utils/builders/tarball.builder';

describe('normalizeRegistryReadme', () => {
  it('returns README text from the registry unchanged', () => {
    expect(normalizeRegistryReadme('# n8n-nodes-test\n\nDoes things.')).toBe('# n8n-nodes-test\n\nDoes things.');
  });

  it("treats npm's missing-README placeholder as no README", () => {
    expect(normalizeRegistryReadme('ERROR: No README data found!')).toBeNull();
  });

  it('treats empty, whitespace-only and non-string values as no README', () => {
    expect(normalizeRegistryReadme('')).toBeNull();
    expect(normalizeRegistryReadme('  \n ')).toBeNull();
    expect(normalizeRegistryReadme(undefined)).toBeNull();
    expect(normalizeRegistryReadme({ readme: 'x' })).toBeNull();
  });
});

describe('extractReadmeFromTarball', () => {
  it('returns the README at the package root', () => {
    const archive = tgz(
      tarEntry('package/package.json', '{"name":"n8n-nodes-test"}'),
      tarEntry('package/README.md', '# n8n-nodes-test\n\nRoot readme.'),
    );

    expect(extractReadmeFromTarball(archive)).toBe('# n8n-nodes-test\n\nRoot readme.');
  });

  it('ignores READMEs below the package root', () => {
    const archive = tgz(
      tarEntry('package/node_modules/dep/README.md', '# dep'),
      tarEntry('package/docs/README.md', '# docs'),
      tarEntry('package/readme.markdown', '# root'),
    );

    expect(extractReadmeFromTarball(archive)).toBe('# root');
  });

  it('does not treat a README outside the top-level directory as the root README', () => {
    const archive = tgz(
      tarEntry('../README.md', '# parent'),
      tarEntry('./../README.md', '# parent again'),
      tarEntry('package/package.json', '{}'),
    );

    expect(extractReadmeFromTarball(archive)).toBeNull();
  });

  it('accepts a root directory that is not named package', () => {
    const archive = tgz(tarEntry('n8n-nodes-test/README.md', '# custom root'));

    expect(extractReadmeFromTarball(archive)).toBe('# custom root');
  });

  it('prefers a Markdown README over another README file at the root', () => {
    const archive = tgz(
      tarEntry('package/README.txt', 'plain'),
      tarEntry('package/README.md', '# markdown'),
    );

    expect(extractReadmeFromTarball(archive)).toBe('# markdown');
  });

  it('reads entry sizes correctly across content longer than one block', () => {
    const archive = tgz(
      tarEntry('package/dist/index.js', 'x'.repeat(1500)),
      tarEntry('package/README.md', '# after a large entry'),
    );

    expect(extractReadmeFromTarball(archive)).toBe('# after a large entry');
  });

  it('applies a pax path record to the entry that follows it', () => {
    const archive = tgz(
      paxPathEntry('package/README.md'),
      tarEntry('package/truncated-name-placeholder', '# named by pax'),
    );

    expect(extractReadmeFromTarball(archive)).toBe('# named by pax');
  });

  it('renames only the one entry that follows a pax path record', () => {
    const archive = tgz(
      paxPathEntry('package/README.md'),
      tarEntry('package/empty-placeholder', '\n'),
      tarEntry('package/index.js', 'module.exports = {};'),
    );

    expect(extractReadmeFromTarball(archive)).toBeNull();
  });

  it('applies a GNU long name to the entry that follows it', () => {
    const archive = tgz(
      tarEntry('././@LongLink', 'package/README.md\0', 'L'),
      tarEntry('package/truncated-name-placeholder', '# named by GNU long name'),
    );

    expect(extractReadmeFromTarball(archive)).toBe('# named by GNU long name');
  });

  it('joins the ustar prefix field and the name', () => {
    const entry = tarEntry('README.md', '# prefixed');
    entry.write('package', 345, 'utf8');

    expect(extractReadmeFromTarball(tgz(entry))).toBe('# prefixed');
  });

  it("cuts a README to the registry's 64 KiB README length", () => {
    const archive = tgz(tarEntry('package/README.md', '#'.repeat(70_000)));

    expect(extractReadmeFromTarball(archive)).toHaveLength(64 * 1024);
  });

  it('counts the README length in characters, as the registry does, not in UTF-8 bytes', () => {
    const readme = extractReadmeFromTarball(tgz(tarEntry('package/README.md', 'ż'.repeat(70_000))));

    expect(readme).toHaveLength(64 * 1024);
    expect(Buffer.byteLength(readme!)).toBe(2 * 64 * 1024);
  });

  it('returns null when the tarball has no root README', () => {
    const archive = tgz(tarEntry('package/package.json', '{}'), tarEntry('package/lib/README.md', '# nested'));

    expect(extractReadmeFromTarball(archive)).toBeNull();
  });

  it('returns null for an empty root README', () => {
    expect(extractReadmeFromTarball(tgz(tarEntry('package/README.md', '\n')))).toBeNull();
  });

  it('returns null for data that is not a gzipped tarball', () => {
    expect(extractReadmeFromTarball(Buffer.from('not a tarball'))).toBeNull();
    expect(extractReadmeFromTarball(gzipSync(Buffer.from('short')))).toBeNull();
  });

  it('returns null when a declared entry size runs past the end of the archive', () => {
    const entry = tarEntry('package/README.md', '# cut off');
    const truncated = gzipSync(entry.subarray(0, 520));

    expect(extractReadmeFromTarball(truncated)).toBeNull();
  });

  it('keeps a README found before the archive breaks off', () => {
    const readme = tarEntry('package/README.txt', 'plain readme');
    const cutEntry = tarEntry('package/dist/index.js', 'x'.repeat(2000)).subarray(0, 600);

    expect(extractReadmeFromTarball(gzipSync(Buffer.concat([readme, cutEntry])))).toBe('plain readme');
  });

  it('returns null instead of inflating past the unpacked size limit', () => {
    const archive = tgz(
      tarEntry('package/dist/bundle.js', 'x'.repeat(8192)),
      tarEntry('package/README.md', '# too late'),
    );

    expect(extractReadmeFromTarball(archive, { maxUnpackedBytes: 4096 })).toBeNull();
  });
});
