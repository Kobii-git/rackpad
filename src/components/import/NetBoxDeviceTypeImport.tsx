import { useState, type ChangeEvent } from "react";
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
import { Mono } from "@/components/shared/Mono";
import { api, ApiError } from "@/lib/api";
import type { NetboxDeviceTypeImportPreview } from "@/lib/api";
import { importNetboxDeviceTypeTemplate, canEditInventory, useStore } from "@/lib/store";

export function NetBoxDeviceTypeImport() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const canEdit = canEditInventory(currentUser);
  const [yamlText, setYamlText] = useState("");
  const [preview, setPreview] = useState<NetboxDeviceTypeImportPreview | null>(
    null,
  );
  const [parseError, setParseError] = useState("");
  const [importError, setImportError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedTemplateName, setImportedTemplateName] = useState("");

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParseError("");
    setImportError("");
    setImportedTemplateName("");
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
    setImportedTemplateName("");
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
    if (!yamlText || !preview || preview.existingTemplate || !canEdit) return;
    setImporting(true);
    setImportError("");
    try {
      const created = await importNetboxDeviceTypeTemplate(yamlText);
      setImportedTemplateName(created.name);
      setPreview(null);
      setYamlText("");
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
          <CardLabel>NetBox device types</CardLabel>
          <CardHeading>Import YAML as a port template</CardHeading>
        </CardTitle>
        <Badge tone="cyan">
          <FileCode2 className="size-3" />
          preview-first import
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-[var(--text-tertiary)]">
          Upload a NetBox device-type-library YAML file to preview manufacturer,
          model, rack height, and interfaces before creating a Rackpad port
          template. This import never changes IPAM, VLANs, or existing templates
          unless you confirm a new template write.
        </p>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]">
          <Upload className="size-4" />
          Choose NetBox YAML
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

        {importedTemplateName && (
          <div className="rounded-[var(--radius-md)] border border-[var(--success-border)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
            Imported port template {importedTemplateName}.
          </div>
        )}

        {preview && (
          <div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PreviewStat label={t("Manufacturer")} value={preview.parsed.manufacturer} />
              <PreviewStat label={t("Model")} value={preview.parsed.model} />
              <PreviewStat label="U-height" value={String(preview.parsed.uHeight)} />
              <PreviewStat
                label={t("Interfaces")}
                value={String(preview.parsed.interfaces.length)}
              />
            </div>

            {preview.existingTemplate && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
                A matching port template already exists: {preview.existingTemplate.name}.
              </div>
            )}

            <div className="rk-table-shell">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th>{t("Name")}</th>
                    <th>{t("Type")}</th>
                    <th>Section</th>
                    <th>Mapped kind</th>
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

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Mono className="text-[10px] text-[var(--text-tertiary)]">
                {preview.portTemplateDraft.description}
              </Mono>
              <Button
                size="sm"
                disabled={
                  !canEdit ||
                  importing ||
                  previewing ||
                  Boolean(preview.existingTemplate)
                }
                onClick={() => void handleImport()}
              >
                <CheckCircle2 className="size-3.5" />
                {importing ? "Importing..." : "Import port template"}
              </Button>
            </div>
          </div>
        )}

        {previewing && (
          <div className="text-sm text-[var(--text-tertiary)]">
            Parsing YAML preview...
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
