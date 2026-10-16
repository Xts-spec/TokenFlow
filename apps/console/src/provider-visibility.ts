import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';

// Restore each provider here after its adaptation is ready for release.
const hiddenProviders = new Set(['doubao', 'cursor']);
export const isProviderVisible = (provider: string) => !hiddenProviders.has(provider);

/** Keep unreleased sources out of account entries and all frontend model pickers. */
export function visibleLocalAgent(snapshot: LocalAgentSnapshot): LocalAgentSnapshot {
 return {
  ...snapshot,
  providers: snapshot.providers.filter(provider => isProviderVisible(provider.id)),
  accounts: snapshot.accounts.filter(account => isProviderVisible(account.provider)),
  models: snapshot.models.filter(model => isProviderVisible(model.provider ?? model.id.split('/')[0])),
  login: snapshot.login && !isProviderVisible(snapshot.login.provider) ? undefined : snapshot.login,
 };
}
