import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePatch } from '../shared/review';
export async function git(cwd: string, args: string[], allowed = [0]) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
      cwd, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' },
    });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('close', code => allowed.includes(code ?? -1) ? resolve(Buffer.concat(output))
      : reject(new Error(Buffer.concat(errors).toString('utf8') || 'Git failed: ' + code)));
  });
}
export async function diff(before: string, after: string) {
  if (before === after) return [];
  const dir = await mkdtemp(join(tmpdir(), 'revu-diff-'));
  try {
    await Promise.all([writeFile(join(dir, 'a'), before), writeFile(join(dir, 'b'), after)]);
    const patch = await git(dir, ['diff', '--no-index', '--no-color', '--no-ext-diff',
      '--no-textconv', '--text', '--unified=0', '--', 'a', 'b'], [0, 1]);
    return parsePatch(patch.toString('utf8'), before, after);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function merge(base: string, draft: string, external: string) {
  if (draft === base || draft === external) return { text: external, conflict: false };
  if (external === base) return { text: draft, conflict: false };
  const dir = await mkdtemp(join(tmpdir(), 'revu-merge-'));
  try {
    await Promise.all([writeFile(join(dir, 'base'), base), writeFile(join(dir, 'draft'), draft),
      writeFile(join(dir, 'external'), external)]);
    // Exit 1..127 denotes textual conflicts; no markers are ever written into the live draft.
    const result = await new Promise<{ text: string; conflict: boolean }>((resolve, reject) => {
      const child = spawn('git', ['merge-file', '-p', '--diff3', 'draft', 'base', 'external'], { cwd: dir, windowsHide: true });
      const out: Buffer[] = [], err: Buffer[] = [];
      child.stdout.on('data', b => out.push(b)); child.stderr.on('data', b => err.push(b));
      child.on('error', reject);
      child.on('close', code => code !== null && code >= 0 && code < 128
        ? resolve({ text: Buffer.concat(out).toString('utf8'), conflict: code !== 0 })
        : reject(new Error(Buffer.concat(err).toString('utf8') || 'Merge failed')));
    });
    return result;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
