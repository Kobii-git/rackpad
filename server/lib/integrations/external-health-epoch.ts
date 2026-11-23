let epoch = 0;
const collections = new Map<string, symbol>();
export function beginExternalHealthWork(connectionId: string) {
  const token = Symbol();
  const started = epoch;
  collections.set(connectionId, token);
  return {
    current: () => started === epoch && collections.get(connectionId) === token,
    finish: () => {
      if (collections.get(connectionId) === token)
        collections.delete(connectionId);
    },
  };
}
export function invalidateExternalHealthWork(connectionId?: string) {
  if (connectionId) collections.delete(connectionId);
  else {
    epoch++;
    collections.clear();
  }
}

export function externalHealthWorkGeneration() { return epoch; }
