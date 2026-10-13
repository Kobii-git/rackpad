type RandomUuidProvider = {
  randomUUID?: () => string;
};

let fallbackSequence = 0;

/**
 * Creates a temporary client-side key without requiring a secure browser
 * context. These identifiers are only used to distinguish unsaved UI records;
 * they are not suitable for authentication, persistence, or security tokens.
 */
export function createEphemeralId(
  provider: RandomUuidProvider | null | undefined = globalThis.crypto,
): string {
  if (typeof provider?.randomUUID === "function") {
    try {
      return provider.randomUUID();
    } catch {
      // Some browsers expose crypto without making randomUUID callable in the
      // current context. Fall back to a process-local UI identifier.
    }
  }

  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `ephemeral-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}
