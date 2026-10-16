// The asset-tooling checkout a local narration regeneration runs (#82). The regeneration imports
// the checkout's working tree, so the recorded revision is only true when that tree is exactly
// the commit: the checkout must be at the pinned revision AND clean (no modified, staged or
// untracked files), otherwise the run is refused before anything is generated.
import { spawnSync } from 'node:child_process';

export type GitRunner = (args: string[]) => { status: number | null; stdout: string; stderr: string };

const defaultGit: GitRunner = (args) => {
  const run = spawnSync('git', args, { encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
};

/** Returns the full HEAD commit of a clean checkout at `revision`; throws naming the problem otherwise. */
export function assertCleanAssetToolingCheckout(checkout: string, revision: string, git: GitRunner = defaultGit): string {
  const head = git(['-C', checkout, 'rev-parse', 'HEAD']);
  if (head.status !== 0 || !head.stdout.trim().startsWith(revision)) {
    throw new Error(`ASSET_TOOLING_CHECKOUT must be at ${revision}, found ${head.stdout.trim() || head.stderr.trim()}`);
  }
  const status = git(['-C', checkout, 'status', '--porcelain', '--untracked-files=all']);
  if (status.status !== 0) throw new Error(`git status failed in ${checkout}: ${status.stderr.trim()}`);
  if (status.stdout.trim() !== '') {
    throw new Error(
      `ASSET_TOOLING_CHECKOUT ${checkout} has local changes; the regeneration would run them but record ${revision}. Clean it first:\n${status.stdout.trimEnd()}`,
    );
  }
  return head.stdout.trim();
}
