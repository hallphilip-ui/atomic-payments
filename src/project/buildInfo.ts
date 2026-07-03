import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type BuildInfo = {
  service: 'atomic-payments';
  version: string;
  buildChannel: string;
  buildSha: string;
  buildTimestamp: string;
  deployEnv: string;
};

function readPackageVersion(): string {
  try {
    const packagePath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readGitSha(): string {
  const explicitSha = process.env.ATOMIC_BUILD_SHA || process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (explicitSha) return explicitSha.slice(0, 40);

  try {
    const gitDir = join(process.cwd(), '.git');
    const headPath = join(gitDir, 'HEAD');
    if (!existsSync(headPath)) return 'local';

    const head = readFileSync(headPath, 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 40);

    const refPath = join(gitDir, head.replace('ref: ', ''));
    if (!existsSync(refPath)) return 'local';
    return readFileSync(refPath, 'utf8').trim().slice(0, 40);
  } catch {
    return 'local';
  }
}

export function getBuildInfo(): BuildInfo {
  return {
    service: 'atomic-payments',
    version: readPackageVersion(),
    buildChannel: process.env.ATOMIC_BUILD_CHANNEL || 'local',
    buildSha: readGitSha(),
    buildTimestamp: process.env.ATOMIC_BUILD_TIMESTAMP || 'local',
    deployEnv: process.env.ATOMIC_DEPLOY_ENV || process.env.NODE_ENV || 'local'
  };
}
