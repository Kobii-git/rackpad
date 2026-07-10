import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, FileCode2, Upload } from "lucide-react";
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
import { api, ApiError } from "@/lib/api";
import type { NetboxDeviceTypeImportPreview } from "@/lib/api";
import {
  canEditInventory,
  importNetboxDeviceType,
  useStore,
} from "@/lib/store";

type ImportMode = "template" | "device";

export function NetBoxDeviceTypeImport() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const canEdit = canEditInventory(currentUser);
  const canManageTemplates = currentUser?.role === "admin";
  const [yamlText, setYamlText] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("template");
  const [hostname, setHostname] = useState("");
  const [preview, setPreview] = useState<NetboxDeviceTypeImportPreview | null>(
    null,
  );
  const [parseError, setParseError] = useState("");
  const [importError, setImportError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState("");

  useEffect(() => {
    if (!preview) return;
    setHostname(preview.deviceDraft.suggestedHostname);
  }, [preview]);

  useEffect(() => {
    if (!canManageTemplates && importMode === "template")
      setImportMode("device");
  }, [canManageTemplates, importMode]);

  const importBlocked = useMemo(() => {
    if (!preview) return true;
    if (importMode === "template") {
      return !canManageTemplates || Boolean(preview.existingTemplate);
    }
    return Boolean(preview.existingDevice);
  }, [canManageTemplates, importMode, preview]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParseError("");
    setImportError("");
    setImportSuccess("");
    setPreview(null);

    try {
      const text = await file.text();
      setYamlText(text);
      await runPreview(text);
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Could not read YAML file.",
      );
    }
  }

  async function runPreview(text: string) {
    setPreviewing(true);
    setParseError("");
    setImportError("");
    setImportSuccess("");
    try {
      const result = await api.previewNetboxDeviceTypeImport(text);
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setParseError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not preview NetBox device type.",
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!yamlText || !preview || importBlocked || !canEdit) return;
    if (importMode === "device" && !hostname.trim()) {
      setImportError(t("Hostname is required for device import."));
      return;
    }

    setImporting(true);
    setImportError("");
    try {
      const result = await importNetboxDeviceType({
        yaml: yamlText,
        mode: importMode,
        labId: lab.id,
        hostname: hostname.trim() || undefined,
      });
      if (result.mode === "template") {
        setImportSuccess(
          t("Imported port template {name}.", { name: result.template.name }),
        );
      } else {
        setImportSuccess(
          t("Imported device {name} with {count} ports.", {
            name: result.device.hostname,
            count: String(result.ports.length),
          }),
        );
      }
      setPreview(null);
      setYamlText("");
      setHostname("");
    } catch (error) {
      setImportError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Import failed.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("NetBox device types")}</CardLabel>
          <CardHeading>{t("Import NetBox YAML")}</CardHeading>
        </CardTitle>
        <Badge tone="cyan">
          <FileCode2 className="size-3" />
          {t("preview-first import")}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-[var(--text-tertiary)]">
          {t(
            "Upload a NetBox device-type-library YAML file to preview manufacturer, model, U-height, and interfaces before creating a port template or device.",
          )}
        </p>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]">
          <Upload className="size-4" />
          {t("Choose NetBox YAML")}
          <input
            type="file"
            accept=".yaml,.yml,text/yaml,text/x-yaml,application/x-yaml"
            className="hidden"
            onChange={(event) => void handleFile(event)}
            disabled={!canEdit}
          />
        </label>

        {parseError && (
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {parseError}
          </div>
        )}

        {importError && (
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {importError}
          </div>
        )}

        {importSuccess && (
          <div className="rounded-[var(--radius-md)] border border-[var(--success-border)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
            {importSuccess}
          </div>
        )}

        {preview && (
          <div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PreviewStat
                label={t("Manufacturer")}
                value={preview.parsed.manufacturer}
              />
              <PreviewStat label={t("Model")} value={preview.parsed.model} />
              <PreviewStat
                label={t("U-height")}
                value={String(preview.parsed.uHeight)}
              />
              <PreviewStat
                label={t("Interfaces")}
                value={String(preview.parsed.interfaces.length)}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--text-secondary)]">
                  {t("Import as")}
                </span>
                <select
                  className="rk-control w-full"
                  value={importMode}
                  onChange={(event) =>
                    setImportMode(event.target.value as ImportMode)
                  }
                >
                  <option value="template" disabled={!canManageTemplates}>
                    {t("Port template only")}
                  </option>
                  <option value="device">{t("Device with interfaces")}</option>
                </select>
              </label>
              {importMode === "device" ? (
                <label className="space-y-1 text-sm">
                  <span className="text-[var(--text-secondary)]">
                    {t("Hostname")}
                  </span>
                  <Input
                    value={hostname}
                    onChange={(event) => setHostname(event.target.value)}
                    placeholder={preview.deviceDraft.suggestedHostname}
                  />
                </label>
              ) : null}
            </div>

            {importMode === "template" && preview.existingTemplate && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
                {t("A matching port template already exists: {name}.", {
                  name: preview.existingTemplate.name,
                })}
              </div>
            )}

            {importMode === "device" && preview.existingDevice && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
                {t("A matching device already exists: {name}.", {
                  name: preview.existingDevice.hostname,
                })}
              </div>
            )}

            {importMode === "device" ? (
              <Mono className="block text-[10px] text-[var(--text-tertiary)]">
                {preview.deviceDraft.heightU
                  ? t(
                      "Will create a {type} device at {u}U with {count} ports.",
                      {
                        type: preview.deviceDraft.deviceType,
                        u: String(preview.deviceDraft.heightU),
                        count: String(preview.deviceDraft.portCount),
                      },
                    )
                  : t("{value1}: {placement} / {value3}: {portCount}", {
                      value1: t("Placement"),
                      placement: preview.deviceDraft.placement,
                      value3: t("Interfaces"),
                      portCount: preview.deviceDraft.portCount,
                    })}
              </Mono>
            ) : (
              <Mono className="block text-[10px] text-[var(--text-tertiary)]">
                {preview.portTemplateDraft.description}
              </Mono>
            )}

            <div className="rk-table-shell">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th>{t("Name")}</th>
                    <th>{t("Type")}</th>
                    <th>{t("Section")}</th>
                    <th>{t("Mapped kind")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.portTemplateDraft.ports.map((port) => {
                    const source = preview.parsed.interfaces.find(
                      (entry) => entry.name === port.name,
                    );
                    return (
                      <tr key={`${port.name}-${port.position}`}>
                        <td className="font-medium text-[var(--text-primary)]">
                          {port.name}
                        </td>
                        <td>
                          <Mono>{source?.type ?? "-"}</Mono>
                        </td>
                        <td>{source?.section ?? "-"}</td>
                        <td>
                          <Mono>{port.kind}</Mono>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!canEdit || importing || previewing || importBlocked}
                onClick={() => void handleImport()}
              >
                <CheckCircle2 className="size-3.5" />
                {importing
                  ? t("Importing...")
                  : importMode === "device"
                    ? t("Import device")
                    : t("Import port template")}
              </Button>
            </div>
          </div>
        )}

        {previewing && (
          <div className="text-sm text-[var(--text-tertiary)]">
            {t("Parsing YAML preview...")}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
      <div className="rk-kicker">{label}</div>
      <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}
