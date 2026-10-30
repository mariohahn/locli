import { spawnSync } from 'node:child_process';

export const MAIN_BRANCHES = ['main', 'master'];
const BRANCH_VARIABLES = ['LOCLI_BRANCH', 'LOCALIZE_BRANCH', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'CI_COMMIT_REF_NAME', 'BITRISE_GIT_BRANCH'];

/**
 * Git branch of the app repository; CI variables first (CI checks out a detached HEAD).
 * @param {string} directory @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function currentBranch(directory, env) {
  for (const variable of BRANCH_VARIABLES) {
    const value = (env[variable] ?? '').trim();
    if (value) return value;
  }
  try {
    const result = spawnSync('git', ['-C', directory, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
    const branch = (result.stdout ?? '').trim();
    return result.status === 0 && branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}
