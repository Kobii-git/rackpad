import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import type { SnmpCredential } from "@/lib/types";

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
    >
      {children}
    </select>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="rk-field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

type CredentialForm = {
  name: string;
  version: "1" | "2c" | "3";
  community: string;
  v3User: string;
  v3AuthProto: "MD5" | "SHA";
  v3AuthPassword: string;
  v3PrivProto: "none" | "AES128";
  v3PrivPassword: string;
  v3Context: string;
};

const EMPTY_FORM: CredentialForm = {
  name: "",
  version: "2c",
  community: "public",
  v3User: "",
  v3AuthProto: "SHA",
  v3AuthPassword: "",
  v3PrivProto: "none",
  v3PrivPassword: "",
  v3Context: "",
};

export function SnmpCredentialsPanel({
  labId,
  credentials,
  disabled,
  onChanged,
}: {
  labId: string;
  credentials: SnmpCredential[];
  disabled?: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [testTarget, setTestTarget] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const labCredentials = useMemo(
    () =>
      [...credentials]
        .filter((entry) => entry.labId === labId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [credentials, labId],
  );

  async function handleCreate() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.createSnmpCredential({
        labId,
        name: form.name.trim(),
        version: form.version,
        community: form.version === "3" ? undefined : form.community.trim(),
        v3User: form.version === "3" ? form.v3User.trim() : undefined,
        v3AuthProto: form.version === "3" ? form.v3AuthProto : undefined,
        v3AuthPassword:
          form.version === "3" ? form.v3AuthPassword.trim() : undefined,
        v3PrivProto: form.version === "3" ? form.v3PrivProto : undefined,
        v3PrivPassword:
          form.version === "3" && form.v3PrivProto === "AES128"
            ? form.v3PrivPassword.trim()
            : undefined,
        v3Context: form.version === "3" ? form.v3Context.trim() || undefined : undefined,
      });
      setForm(EMPTY_FORM);
      setMessage("SNMP credential saved.");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credential.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.deleteSnmpCredential(id);
      if (selectedId === id) setSelectedId("");
      setMessage("SNMP credential deleted.");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete credential.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id: string) {
    if (!testTarget.trim()) {
      setError("Enter a target IP or hostname to test SNMP.");
      return;
    }
    setTestingId(id);
    setError("");
    setMessage("");
    try {
      const result = await api.testSnmpCredential(id, {
        target: testTarget.trim(),
      });
      setMessage(`SNMP test OK: ${result.target} sysUpTime.0 = ${result.value}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SNMP test failed.");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="grid gap-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div>
        <div className="text-sm font-medium text-[var(--color-fg)]">
          Lab SNMP credentials
        </div>
        <div className="text-sm text-[var(--color-fg-subtle)]">
          Shared per lab. Secrets are encrypted at rest when{" "}
          <code className="text-xs">RACKPAD_SECRET_KEY</code> is configured on
          the server.
        </div>
      </div>

      {labCredentials.length > 0 && (
        <div className="grid gap-2">
          {labCredentials.map((credential) => (
            <div
              key={credential.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium text-[var(--color-fg)]">
                  {credential.name}
                </div>
                <div className="text-xs text-[var(--color-fg-subtle)]">
                  v{credential.version}
                  {credential.version === "3" && credential.v3User
                    ? ` · ${credential.v3User}`
                    : ""}
                  {credential.version !== "3" && credential.hasCommunity
                    ? " · community stored"
                    : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled || testingId === credential.id}
                  onClick={() => handleTest(credential.id)}
                >
                  {testingId === credential.id ? "Testing…" : "Test SNMP"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled || saving}
                  onClick={() => handleDelete(credential.id)}
                >
                  {t("Delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Test target">
          <Input
            value={testTarget}
            disabled={disabled}
            onChange={(event) => setTestTarget(event.target.value)}
            placeholder="10.0.0.1"
          />
        </Field>
        <Field label="New credential name">
          <Input
            value={form.name}
            disabled={disabled || saving}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="Core switch RO"
          />
        </Field>
        <Field label="Version">
          <Select
            value={form.version}
            disabled={disabled || saving}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                version: value as CredentialForm["version"],
              }))
            }
          >
            <option value="2c">v2c</option>
            <option value="1">v1</option>
            <option value="3">v3</option>
          </Select>
        </Field>
        {form.version === "3" ? (
          <>
            <Field label={t("Username")}>
              <Input
                value={form.v3User}
                disabled={disabled || saving}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, v3User: event.target.value }))
                }
              />
            </Field>
            <Field label="Auth protocol">
              <Select
                value={form.v3AuthProto}
                disabled={disabled || saving}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    v3AuthProto: value as CredentialForm["v3AuthProto"],
                  }))
                }
              >
                <option value="SHA">SHA</option>
                <option value="MD5">MD5</option>
              </Select>
            </Field>
            <Field label="Auth password">
              <Input
                type="password"
                value={form.v3AuthPassword}
                disabled={disabled || saving}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    v3AuthPassword: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Privacy">
              <Select
                value={form.v3PrivProto}
                disabled={disabled || saving}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    v3PrivProto: value as CredentialForm["v3PrivProto"],
                  }))
                }
              >
                <option value="none">authNoPriv</option>
                <option value="AES128">authPriv (AES128)</option>
              </Select>
            </Field>
            {form.v3PrivProto === "AES128" && (
              <Field label="Privacy password">
                <Input
                  type="password"
                  value={form.v3PrivPassword}
                  disabled={disabled || saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      v3PrivPassword: event.target.value,
                    }))
                  }
                />
              </Field>
            )}
            <Field label="Context">
              <Input
                value={form.v3Context}
                disabled={disabled || saving}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, v3Context: event.target.value }))
                }
                placeholder="Optional"
              />
            </Field>
          </>
        ) : (
          <Field label={t("Community")}>
            <Input
              value={form.community}
              disabled={disabled || saving}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, community: event.target.value }))
              }
            />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled || saving || !form.name.trim()}
          onClick={handleCreate}
        >
          {saving ? t("Saving...") : "Add credential"}
        </Button>
      </div>

      {message && (
        <div className="text-sm text-[var(--color-ok)]">{message}</div>
      )}
      {error && <div className="text-sm text-[var(--color-err)]">{error}</div>}
    </div>
  );
}

export function snmpCredentialLabel(
  credentials: SnmpCredential[],
  credentialId?: string | null,
) {
  if (!credentialId) return "Inline community";
  return credentials.find((entry) => entry.id === credentialId)?.name ?? credentialId;
}
