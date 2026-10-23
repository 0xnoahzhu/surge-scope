import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export function assignBundleUuid(binary: Buffer, appId: string): Buffer {
  const output = Buffer.from(binary);
  if (output.length < 32 || output.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error("Expected a thin 64-bit Mach-O executable.");
  let offset = 32;
  const commands = output.readUInt32LE(16);
  for (let index = 0; index < commands; index++) {
    if (offset + 8 > output.length)
      throw new Error("Invalid Mach-O load command.");
    const command = output.readUInt32LE(offset),
      size = output.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > output.length)
      throw new Error("Invalid Mach-O load command size.");
    if (command === 0x1b) {
      if (size !== 24) throw new Error("Invalid LC_UUID command.");
      const original = output.subarray(offset + 8, offset + 24);
      // Apple TN3179 requires an app-specific executable UUID for network privacy.
      // Electron redistributes one executable UUID to all downstream applications.
      const uuid = createHash("sha256")
        .update(appId)
        .update(original)
        .digest()
        .subarray(0, 16);
      uuid[6] = (uuid[6] & 0x0f) | 0x50;
      uuid[8] = (uuid[8] & 0x3f) | 0x80;
      uuid.copy(output, offset + 8);
      return output;
    }
    offset += size;
  }
  throw new Error("No LC_UUID command found.");
}
export default async function afterPack(context: {
  electronPlatformName: string;
  appOutDir: string;
  packager: { appInfo: { productFilename: string; id: string } };
}) {
  if (context.electronPlatformName !== "darwin") return;
  const name = context.packager.appInfo.productFilename;
  const path = join(
    context.appOutDir,
    name + ".app",
    "Contents",
    "MacOS",
    name,
  );
  await writeFile(
    path,
    assignBundleUuid(await readFile(path), context.packager.appInfo.id),
  );
}
