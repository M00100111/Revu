export async function readDirectory(handle: FileSystemDirectoryHandle) {
  const entries: FileSystemHandle[] = [];
  for await (const entry of handle.values()) entries.push(entry);
  return entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1,
  );
}
export async function writeFile(handle: FileSystemFileHandle, text: string) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}