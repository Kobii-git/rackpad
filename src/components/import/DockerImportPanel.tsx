import { useMemo, useState } from "react";
import { CheckCircle2, Container } from "lucide-react";
import { useI18n } from "@/i18n";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { api, ApiError, type DockerContainerPreview } from "@/lib/api";
import {
  canEditInventory,
  importDockerContainerRecord,
  useStore,
} from "@/lib/store";

export function DockerImportPanel() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const canEdit = canEditInventory(currentUser);
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:2375");
  const [token, setToken] = useState("");
  const [hostDeviceId, setHostDeviceId] = useState("");
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [containers, setContainers] = useState<DockerContainerPreview[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const hostDevices = useMemo(
    () =>
      devices.filter(
        (device) =>
          device.labId === lab.id &&
          ["server", "vm", "container"].includes(device.deviceType),
      ),
    [devices, lab.id],
  );

  async function handlePreview() {
    setPreviewing(true);
    setError("");
    setSuccess("");
    setContainers([]);
    setSelectedContainerId("");
    try {
      const result = await api.previewDockerImport({
        endpoint: endpoint.trim(),
        token: token.trim() || undefined,
      });
      setContainers(result.containers);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Docker preview failed.",
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!selectedContainerId || !hostDeviceId || !canEdit) return;
    setImporting(true);
    setError("");
    setSuccess("");
    try {
      const created = await importDockerContainerRecord({
        endpoint: endpoint.trim(),
        token: token.trim() || undefined,
        containerId: selectedContainerId,
        labId: lab.id,
        hostDeviceId,
      });
      setSuccess(t("Imported container {name}.", { name: created.hostname }));
      setSelectedContainerId("");
      setContainers([]);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Docker import failed.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Docker / Portainer</CardLabel>
          <CardHeading>{t("Docker container import")}</CardHeading>
        </CardTitle>
        <Badge tone="cyan">
          <Container className="size-3" />
          read-only preview
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-[var(--text-tertiary)]">
          Paste a Docker Engine API base URL (or Portainer proxy URL) to preview
          containers. Credentials are sent only for this request and are not stored.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--text-secondary)]">{t("Docker endpoint")}</span>
            <Input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              disabled={!canEdit}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--text-secondary)]">
              {t("API token (optional, not stored)")}
            </span>
            <Input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={!canEdit}
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-[var(--text-secondary)]">{t("Host device")}</span>
            <select
              className="rk-control w-full"
              value={hostDeviceId}
              onChange={(event) => setHostDeviceId(event.target.value)}
              disabled={!canEdit}
            >
              <option value="">{t("Select a host device")}</option>
              {hostDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.hostname}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || previewing || !endpoint.trim()}
            onClick={() => void handlePreview()}
          >
            {previewing ? t("Importing...") : t("Preview containers")}
          </Button>
          <Button
            size="sm"
            disabled={
              !canEdit ||
              importing ||
              !selectedContainerId ||
              !hostDeviceId
            }
            onClick={() => void handleImport()}
          >
            <CheckCircle2 className="size-3.5" />
            {importing ? t("Importing...") : t("Import container")}
          </Button>
        </div>
        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-[var(--radius-md)] border border-[var(--success-border)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
            {success}
          </div>
        )}
        {containers.length > 0 && (
          <div className="rk-table-shell">
            <table className="rk-table">
              <thead>
                <tr>
                  <th>{t("Select a container")}</th>
                  <th>{t("Name")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((container) => (
                  <tr key={container.id}>
                    <td>
                      <input
                        type="radio"
                        name="docker-container"
                        checked={selectedContainerId === container.id}
                        onChange={() => setSelectedContainerId(container.id)}
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="font-medium text-[var(--text-primary)]">
                      {container.name}
                    </td>
                    <td>
                      <Mono>{container.image}</Mono>
                    </td>
                    <td>{container.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
