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
