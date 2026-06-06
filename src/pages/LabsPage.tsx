import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import {
  createLabRecord,
  deleteLabRecord,
  isAdmin,
  selectLab,
  updateLabRecord,
  useStore,
} from "@/lib/store";
import type { Lab } from "@/lib/types";
import { Check, Pencil, Plus, Save, Trash2 } from "lucide-react";

type LabForm = {
  name: string;
  description: string;
  location: string;
};

const EMPTY_FORM: LabForm = {
  name: "",
  description: "",
  location: "",
};

export default function LabsPage() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const currentLab = useStore((s) => s.lab);
  const labs = useStore((s) => s.labs);
  const canManage = isAdmin(currentUser);
  const [editingLabId, setEditingLabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<LabForm>(EMPTY_FORM);

  useEffect(() => {
    if (creating) return;
    const target = labs.find((lab) => lab.id === editingLabId) ?? currentLab;
    setForm({
      name: target.name,
      description: target.description ?? "",
      location: target.location ?? "",
    });
  }, [creating, currentLab, editingLabId, labs]);

  const editingLab = labs.find((lab) => lab.id === editingLabId) ?? null;

  async function handleSwitchLab(labId: string) {
    setPendingSwitchId(labId);
    setError("");
    try {
      await selectLab(labId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch labs.");
    } finally {
      setPendingSwitchId(null);
    }
  }

  async function handleSaveLab() {
    if (!canManage) return;
    setSaving(true);
    setError("");
    try {
      if (creating) {
        await createLabRecord({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          location: form.location.trim() || undefined,
        });
        setCreating(false);
        setEditingLabId(null);
      } else if (editingLab) {
        await updateLabRecord(editingLab.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          location: form.location.trim() || null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lab.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLab() {
    if (!canManage || !editingLab) return;
    if (
      !window.confirm(
        `Delete lab ${editingLab.name}? This removes its racks, devices, VLANs, and IPAM data.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setError("");
    try {
      await deleteLabRecord(editingLab.id);
      setEditingLabId(null);
      setCreating(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lab.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <TopBar
        subtitle="Workspace"
        title={t("Labs")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {labs.length} total
          </span>
        }
        actions={
          canManage ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreating(true);
                setEditingLabId(null);
                setForm(EMPTY_FORM);
                setError("");
              }}
            >
              <Plus className="size-3.5" />
              Add lab
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-1 gap-6 overflow-hidden px-6 py-5">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {labs.map((lab) => {
              const active = lab.id === currentLab.id;
              const editing = lab.id === editingLabId;
              return (
                <Card
                  key={lab.id}
                  className={
                    active ? "border-[var(--color-accent)]/40" : undefined
                  }
                >
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>{active ? "Current lab" : t("Lab")}</CardLabel>
                      <CardHeading>{lab.name}</CardHeading>
                    </CardTitle>
                    {active ? (
                      <Badge tone="accent">
                        <Check className="size-3" />
                        Active
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleSwitchLab(lab.id)}
                        disabled={pendingSwitchId === lab.id}
                      >
                        {pendingSwitchId === lab.id
                          ? "Switching..."
                          : "Use lab"}
                      </Button>
                    )}
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <MetaRow
                      label="Location"
                      value={lab.location || "Not set"}
                    />
                    <MetaRow
                      label={t("Description")}
                      value={lab.description || "No description yet"}
                    />
                    {canManage && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant={editing ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            setCreating(false);
                            setEditingLabId(lab.id);
                            setError("");
                          }}
                        >
                          <Pencil className="size-3.5" />
                          {editing ? "Editing" : t("Edit")}
                        </Button>
                      </div>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </div>

        {canManage && (creating || editingLab) && (
          <div className="w-full max-w-md shrink-0 overflow-y-auto">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{creating ? "New lab" : "Lab editor"}</CardLabel>
                  <CardHeading>
                    {creating
                      ? "Create lab workspace"
                      : `Update ${editingLab?.name}`}
                  </CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field label="Lab name">
                  <Input
                    value={form.name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Home Lab"
                  />
                </Field>
                <Field label="Location">
                  <Input
                    value={form.location}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        location: event.target.value,
                      }))
                    }
                    placeholder="Office, garage, Colo row A"
                  />
                </Field>
                <Field label={t("Description")}>
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
                    placeholder="What this lab is for, where it lives, who owns it..."
                  />
                </Field>

                {error && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreating(false);
                      setEditingLabId(null);
                      setError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <div className="flex items-center gap-2">
                    {!creating && labs.length > 1 && editingLab && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteLab()}
                        disabled={deleting}
                      >
                        <Trash2 className="size-3.5" />
                        {deleting ? "Deleting..." : "Delete lab"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => void handleSaveLab()}
                      disabled={saving}
                    >
                      <Save className="size-3.5" />
                      {saving
                        ? "Saving..."
                        : creating
                          ? "Create lab"
                          : "Save lab"}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="text-sm text-[var(--color-fg)]">{value}</div>
    </div>
  );
}
