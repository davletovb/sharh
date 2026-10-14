import {readFile, readdir, writeFile} from 'node:fs/promises';
import {deflateRawSync, crc32} from 'node:zlib';
import {join, relative} from 'node:path';
// ZIP timestamps, order, attributes and compression are fixed; no machine paths enter the package.
async function files(root) {
  const paths = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await files(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}
const root = 'dist/sharh',
  local = [],
  central = [];
let offset = 0;
for (const path of await files(root)) {
  const name = Buffer.from(relative(root, path).replaceAll('\\', '/')),
    data = await readFile(path),
    packed = deflateRawSync(data, {level: 9}),
    crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, packed);
  const index = Buffer.alloc(46);
  index.writeUInt32LE(0x02014b50);
  index.writeUInt16LE(0x314, 4);
  index.writeUInt16LE(20, 6);
  index.writeUInt16LE(0x800, 8);
  index.writeUInt16LE(8, 10);
  index.writeUInt16LE(33, 14);
  index.writeUInt32LE(crc, 16);
  index.writeUInt32LE(packed.length, 20);
  index.writeUInt32LE(data.length, 24);
  index.writeUInt16LE(name.length, 28);
  index.writeUInt32LE(0x81a40000, 38);
  index.writeUInt32LE(offset, 42);
  central.push(index, name);
  offset += header.length + name.length + packed.length;
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
await writeFile('dist/sharh.zip', Buffer.concat([...local, directory, end]));
