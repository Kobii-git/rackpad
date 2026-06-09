import { ValidationError } from "./validation.js";

export interface DockerContainerPreview {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function normalizeDockerEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError("Docker endpoint must be a valid http(s) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ValidationError("Docker endpoint must use http or https.");
  }
  return url;
}

export function parseDockerContainersJson(data: unknown): DockerContainerPreview[] {
  if (!Array.isArray(data)) {
    throw new ValidationError("Docker API response must be a JSON array.");
  }

  return data.map((entry, index) => {
    const row = asRecord(entry, `containers[${index}]`);
    const id = String(row.Id ?? row.ID ?? row.id ?? "").trim();
    const names = Array.isArray(row.Names) ? row.Names : [];
    const name =
      String(names[0] ?? row.Name ?? row.name ?? id)
        .replace(/^\//, "")
        .trim() || id;
    const image = String(row.Image ?? row.image ?? "unknown").trim() || "unknown";
    const state = String(row.State ?? row.state ?? "unknown").trim() || "unknown";
    const status = String(row.Status ?? row.status ?? state).trim() || state;

    if (!id) {
      throw new ValidationError(`containers[${index}] is missing an id.`);
    }

    return { id, name, image, state, status };
  });
}

export async function fetchDockerContainersPreview(
  endpoint: string,
  token?: string,
): Promise<DockerContainerPreview[]> {
  const base = normalizeDockerEndpoint(endpoint);
  const url = new URL("/containers/json?all=1", base);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    throw new ValidationError(`Could not reach Docker endpoint: ${message}`);
  }

  if (!response.ok) {
    throw new ValidationError(
      `Docker endpoint returned HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as unknown;
  return parseDockerContainersJson(payload);
}

export function buildDockerContainerNotes(
  container: DockerContainerPreview,
  endpoint: string,
) {
  return `docker-import | image: ${container.image} | status: ${container.status} | source: ${endpoint}`;
}

export function buildDockerContainerSpecs(container: DockerContainerPreview) {
  return `docker-image: ${container.image}`;
}
