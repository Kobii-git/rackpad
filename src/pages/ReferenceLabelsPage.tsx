import { createPortal } from "react-dom";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import {
  canEditInventory,
  generateInventoryReference,
  useStore,
} from "@/lib/store";
import { useI18n } from "@/i18n";

type Label = {
  id: string;
  kind: "device" | "cable";
  name: string;
  publicReference?: string | null;
};
export default function ReferenceLabelsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const devices = useStore((s) => s.devices),
    cables = useStore((s) => s.portLinks),
    ports = useStore((s) => s.ports);
  const currentUser = useStore((s) => s.currentUser);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lookup, setLookup] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows: Label[] = [
    ...devices.map((d) => ({
      id: d.id,
      kind: "device" as const,
      name: d.displayName || d.hostname,
      publicReference: d.publicReference,
    })),
    ...cables.map((c) => ({
      id: c.id,
      kind: "cable" as const,
      name:
        c.label ||
        [c.fromPortId, c.toPortId]
          .map((id) => {
            const port = ports.find((p) => p.id === id);
            return `${devices.find((d) => d.id === port?.deviceId)?.hostname || ""}:${port?.name || id}`;
          })
          .join(" ↔ "),
      publicReference: c.publicReference,
    })),
  ];
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  function key(row: Label) {
    return `${row.kind}:${row.id}`;
  }
  function href(row: Label) {
    return row.kind === "device"
      ? `/devices/${encodeURIComponent(row.id)}`
      : row.publicReference
        ? `/labels/${row.publicReference}`
        : "/cables";
  }
  const selectedRows = rows.filter((row) => selected.has(key(row)));
  return (
    <div className="flex h-full flex-col">
      <TopBar title={t("Labels")} />
      <main className="space-y-4 overflow-auto p-6">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await api.lookupReference(lookup);
              navigate(`/labels/${result.publicReference}`);
            });
          }}
        >
          <label className="flex items-center gap-2">
            {t("Reference")}
            <Input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              dir="ltr"
            />
          </label>
          <Button disabled={busy || !lookup} type="submit">
            {t("Find reference")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {canEditInventory(currentUser) && (
            <Button
              disabled={busy || !selectedRows.length}
              onClick={() =>
                void run(async () => {
                  for (const row of selectedRows) {
                    await generateInventoryReference(row.kind, row.id);
                  }
                })
              }
            >
              {t("Generate references")}
            </Button>
          )}
          <Button
            disabled={
              busy ||
              !selectedRows.length ||
              selectedRows.some((row) => !row.publicReference)
            }
            onClick={() => window.print()}
          >
            {t("Print labels")}
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        <table className="w-full text-start text-sm">
          <thead>
            <tr>
              <th>{t("Select")}</th>
              <th>{t("Type")}</th>
              <th>{t("Name")}</th>
              <th>{t("Reference")}</th>
              <th>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={key(row)}
                className="border-b border-[var(--border-subtle)]"
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={t("Select {hostname}", { hostname: row.name })}
                    checked={selected.has(key(row))}
                    onChange={(e) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(key(row));
                        else next.delete(key(row));
                        return next;
                      })
                    }
                  />
                </td>
                <td>{t(row.kind === "device" ? "Device" : "Cable")}</td>
                <td>
                  <Link to={href(row)}>{row.name}</Link>
                </td>
                <td className="font-mono" dir="ltr">
                  {row.publicReference || "—"}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    disabled={!row.publicReference || busy}
                    onClick={() =>
                      void run(() =>
                        navigator.clipboard.writeText(row.publicReference!),
                      )
                    }
                  >
                    {t("Copy")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {createPortal(
          <div className="reference-label-sheet hidden" aria-hidden="true">
            {selectedRows
              .filter((row) => row.publicReference)
              .map((row) => (
                <div className="reference-label" key={key(row)}>
                  <strong>{row.name}</strong>
                  <span>{t(row.kind === "device" ? "Device" : "Cable")}</span>
                  <code dir="ltr">
                    {row.publicReference!.slice(0, 4)}-
                    {row
                      .publicReference!.slice(4)
                      .match(/.{1,4}/g)!
                      .join("-")}
                  </code>
                </div>
              ))}
          </div>,
          document.body,
        )}
      </main>
    </div>
  );
}
