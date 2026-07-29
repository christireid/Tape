import { useSyncExternalStore } from 'react';
import { store } from './marketStore.ts';

/**
 * The ONE hook that subscribes React to the store's ~4 Hz slow channel.
 * Nothing else in React subscribes to onFrame. If a second onFrame subscription
 * appears in a component, the architecture has been violated.
 */
export function useSlowTick(): number {
  return useSyncExternalStore(
    (cb) => store.onSlow(cb),
    () => store.slowVersion,
    () => store.slowVersion,
  );
}
