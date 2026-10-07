import { requestGitHubApi } from './github-api-resilience.cjs';

export async function verifyImmutableRelease(
  repository,
  request = (endpoint) => requestGitHubApi(endpoint, { token: process.env.GITHUB_TOKEN }),
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid release repository');
  const state = await request(`repos/${repository}/immutable-releases`);
  if (state?.enabled !== true) throw new Error('Immutable releases must be enabled before publication');
}
if (import.meta.main) await verifyImmutableRelease(process.env.GITHUB_REPOSITORY);
