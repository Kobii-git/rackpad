import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import {
  createUserAccount,
  deleteUserAccount,
  downloadAdminBackup,
  isAdmin,
  restoreAdminBackupSnapshot,
  updateUiSettings,
  updateUserAccount,
  useStore,
} from "@/lib/store";
import type {
  AlertSettings,
  AdminIntegrityReport,
  AuditEntry,
  AppUser,
  Lab,
  LabAccessEntry,
  LabRole,
  SupportedLanguage,
  UserRole,
} from "@/lib/types";
import { APP_VERSION_LABEL } from "@/lib/version";
import { LANGUAGE_NATIVE_NAMES, LANGUAGE_OPTIONS, LanguageSelector, useI18n } from "@/i18n";
import {
  Download,
  Languages,
  Plus,
  Save,
  Shield,
  Trash2,
  Upload,
  UserRound,
  BellRing,
} from "lucide-react";

type FormState = {
  username: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  password: string;
  labRoles: Record<string, LabRole | "none">;
};

const EMPTY_FORM: FormState = {
  username: "",
  displayName: "",
  role: "viewer",
  disabled: false,
  password: "",
  labRoles: {},
};

function roleChipLabel(role: UserRole, t: ReturnType<typeof useI18n>["t"]) {
  if (role === "admin") return t("Administrator");
  if (role === "editor") return t("Editor");
  return t("Viewer");
}

function defaultLabRoles(labs: Lab[], role: UserRole): Record<string, LabRole | "none"> {
  if (role === "admin") return {};
  const labRole: LabRole = role === "viewer" ? "viewer" : "editor";
  return Object.fromEntries(labs.map((lab) => [lab.id, labRole]));
}

function labRolesFromUser(user: AppUser, labs: Lab[]): Record<string, LabRole | "none"> {
  return Object.fromEntries(
    labs.map((lab) => {
      const entry = user.labAccess?.find((access) => access.labId === lab.id);
      return [lab.id, entry?.role ?? "none"];
    }),
  );
}

function labAccessPayload(labRoles: Record<string, LabRole | "none">): LabAccessEntry[] {
  return Object.entries(labRoles)
    .filter((entry): entry is [string, LabRole] => entry[1] === "editor" || entry[1] === "viewer")
    .map(([labId, role]) => ({ labId, role }));
}

const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: false,
  notifyOnDown: true,
  notifyOnRecovery: true,
  repeatWhileOffline: false,
  repeatIntervalMinutes: 60,
  discordWebhookUrl: null,
  telegramBotToken: null,
  telegramChatId: null,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: null,
  smtpPassword: null,
  smtpFrom: null,
  smtpTo: null,
};

export default function UsersPage() {
  const { language, t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const uiSettings = useStore((s) => s.uiSettings);
  const users = useStore((s) => s.users);
  const labs = useStore((s) => s.labs);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(
    DEFAULT_ALERT_SETTINGS,
  );
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [alertError, setAlertError] = useState("");
  const [alertSuccess, setAlertSuccess] = useState("");
  const [alertHistory, setAlertHistory] = useState<AuditEntry[]>([]);
  const [alertHistoryLoading, setAlertHistoryLoading] = useState(true);
  const [alertHistoryError, setAlertHistoryError] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>(
    uiSettings.defaultLanguage,
  );
  const [languageSaving, setLanguageSaving] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const [languageSuccess, setLanguageSuccess] = useState("");
  const [integrityReport, setIntegrityReport] = useState<AdminIntegrityReport | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityError, setIntegrityError] = useState("");

  useEffect(() => {
    setDefaultLanguage(uiSettings.defaultLanguage);
  }, [uiSettings.defaultLanguage]);

  async function loadIntegrityReport() {
    setIntegrityLoading(true);
    setIntegrityError("");
    try {
      setIntegrityReport(await api.getAdminIntegrity());
    } catch (err) {
      setIntegrityError(err instanceof Error ? err.message : "Failed to load data integrity report.");
    } finally {
      setIntegrityLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin(currentUser)) void loadIntegrityReport();
  }, [currentUser]);

  useEffect(() => {
    if (!users.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(users[0].id);
    }
  }, [selectedUserId, users]);

  const selectedUser = useMemo(
    () =>
      selectedUserId
        ? users.find((user) => user.id === selectedUserId)
        : undefined,
    [selectedUserId, users],
  );

  useEffect(() => {
    if (creating) {
      setForm({
        ...EMPTY_FORM,
        labRoles: defaultLabRoles(labs, EMPTY_FORM.role),
      });
      setError("");
      return;
    }

    if (selectedUser) {
      setForm({
        username: selectedUser.username,
        displayName: selectedUser.displayName,
        role: selectedUser.role,
        disabled: selectedUser.disabled,
        password: "",
        labRoles:
          selectedUser.role === "admin"
            ? {}
            : labRolesFromUser(selectedUser, labs),
      });
      setError("");
    }
  }, [creating, labs, selectedUser]);

  useEffect(() => {
    if (!isAdmin(currentUser)) {
      setAlertsLoading(false);
      setAlertHistoryLoading(false);
      return;
    }

    let cancelled = false;

    async function loadAlertSettings() {
      setAlertsLoading(true);
      setAlertError("");
      try {
        const settings = await api.getAlertSettings();
        if (!cancelled) {
          setAlertSettings(settings);
        }
      } catch (err) {
        if (!cancelled) {
          setAlertError(
            err instanceof Error
              ? err.message
              : "Failed to load notification settings.",
          );
        }
      } finally {
        if (!cancelled) {
          setAlertsLoading(false);
        }
      }
    }

    void loadAlertSettings();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!isAdmin(currentUser)) return;

    let cancelled = false;

    async function loadAlertHistory() {
      setAlertHistoryLoading(true);
      setAlertHistoryError("");
      try {
        const entries = await api.getAuditLog({
          entityType: "Alert",
          limit: 40,
        });
        if (!cancelled) {
          setAlertHistory(entries);
        }
      } catch (err) {
        if (!cancelled) {
          setAlertHistoryError(
            err instanceof Error
              ? err.message
              : "Failed to load alert history.",
          );
        }
      } finally {
        if (!cancelled) {
          setAlertHistoryLoading(false);
        }
      }
    }

    void loadAlertHistory();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  if (!isAdmin(currentUser)) {
    return (
      <>
        <TopBar subtitle={t("Administration")} title={t("Admin")} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Restricted")}</CardLabel>
                <CardHeading>{t("Administrator access required")}</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="text-sm text-[var(--color-fg-subtle)]">
              {t("This page is only available to administrator accounts.")}
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      if (creating) {
        const created = await createUserAccount({
          username: form.username.trim(),
          displayName: form.displayName.trim() || undefined,
          password: form.password,
          role: form.role,
          disabled: form.disabled,
          labAccess:
            form.role === "admin" ? undefined : labAccessPayload(form.labRoles),
        });
        setCreating(false);
        setSelectedUserId(created.id);
        return;
      }

      if (!selectedUser) return;
      const updated = await updateUserAccount(selectedUser.id, {
        username: form.username.trim(),
        displayName: form.displayName.trim() || null,
        role: form.role,
        disabled: form.disabled,
        password: form.password.trim() ? form.password : undefined,
        labAccess:
          form.role === "admin" ? [] : labAccessPayload(form.labRoles),
      });
      setSelectedUserId(updated.id);
      setForm((prev) => ({ ...prev, password: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedUser) return;
    if (!window.confirm(`Delete user ${selectedUser.username}?`)) return;

    setDeleting(true);
    setError("");
    try {
      await deleteUserAccount(selectedUser.id);
      setSelectedUserId(null);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError("");
    setExportSuccess("");
    try {
      const filename = await downloadAdminBackup();
      setExportSuccess(`Downloaded ${filename}`);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export backup.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleRestore() {
    if (!restoreFile) {
      setRestoreError("Choose a backup JSON file first.");
      return;
    }
    if (
      !window.confirm(
        "Restore this backup and replace the current database contents? You will need to sign in again.",
      )
    ) {
      return;
    }

    setRestoring(true);
    setRestoreError("");
    setExportSuccess("");
    try {
      const raw = await restoreFile.text();
      const snapshot = JSON.parse(raw) as unknown;
      await restoreAdminBackupSnapshot(snapshot);
      window.alert("Backup restored. Please sign in again.");
    } catch (err) {
      setRestoreError(
        err instanceof Error ? err.message : "Failed to restore backup.",
      );
    } finally {
      setRestoring(false);
    }
  }

  async function handleSaveAlerts() {
    setAlertSaving(true);
    setAlertError("");
    setAlertSuccess("");
    try {
      const saved = await api.updateAlertSettings(alertSettings);
      setAlertSettings(saved);
      setAlertSuccess("Notification settings saved.");
    } catch (err) {
      setAlertError(
        err instanceof Error
          ? err.message
          : "Failed to save notification settings.",
      );
    } finally {
      setAlertSaving(false);
    }
  }

  async function handleTestAlert() {
    setAlertTesting(true);
    setAlertError("");
    setAlertSuccess("");
    try {
      const result = await api.sendAlertSettingsTest();
      setAlertSuccess(
        `Test alert delivered via ${result.channels.map((channel) => channel.channel).join(", ")}.`,
      );
      const entries = await api.getAuditLog({ entityType: "Alert", limit: 40 });
      setAlertHistory(entries);
    } catch (err) {
      setAlertError(
        err instanceof Error ? err.message : "Failed to send test alert.",
      );
    } finally {
      setAlertTesting(false);
    }
  }

  async function handleSaveLanguage() {
    setLanguageSaving(true);
    setLanguageError("");
    setLanguageSuccess("");
    try {
      await updateUiSettings({ defaultLanguage });
      setLanguageSuccess(t("Language settings saved."));
    } catch (err) {
      setLanguageError(
        err instanceof Error
          ? err.message
          : t("Failed to save language settings."),
      );
    } finally {
      setLanguageSaving(false);
    }
  }

  async function clearInvalidAssignmentReferences(
    issue: AdminIntegrityReport["assignmentReferences"][number],
  ) {
    if (!window.confirm(`Clear invalid target references from ${issue.ipAddress}?`)) return;
    const patch = Object.fromEntries(issue.integrity.fields.map((field) => [field, null]));
    try {
      await api.updateIpAssignment(issue.id, patch);
      await loadIntegrityReport();
    } catch (err) {
      setIntegrityError(err instanceof Error ? err.message : "Failed to clear invalid references.");
    }
  }

  return (
    <>
      <TopBar
        subtitle={t("Administration")}
        title={t("Admin")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {t("{count} accounts", { count: users.length })}
          </span>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(true);
              setSelectedUserId(null);
            }}
          >
            <Plus className="size-3.5" />
            {t("Add user")}
          </Button>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]/40">
          <div className="border-b border-[var(--color-line)] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">{t("Accounts")}</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {users.map((user) => {
              const active = !creating && user.id === selectedUserId;
              return (
                <button
                  key={user.id}
                  onClick={() => {
                    setCreating(false);
                    setSelectedUserId(user.id);
                  }}
                  className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                    active
                      ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
                      : "border-transparent hover:bg-[var(--color-surface)]/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                      {user.displayName}
                    </div>
                    <Badge
                      tone={
                        user.role === "admin"
                          ? "accent"
                          : user.role === "editor"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {roleChipLabel(user.role, t)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      @{user.username}
                    </span>
                    <Badge tone={user.authProvider === "oidc" ? "info" : "neutral"}>
                      {user.authProvider === "oidc" ? "oidc" : "local"}
                    </Badge>
                  </div>
                  {user.disabled && (
                    <div className="mt-1 text-[11px] text-[var(--color-err)]">{t("Disabled")}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-3xl space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Data integrity")}</CardLabel>
                  <CardHeading>{t("IPAM repair queue")}</CardHeading>
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => void loadIntegrityReport()} disabled={integrityLoading}>
                  {integrityLoading ? "Checking..." : "Recheck"}
                </Button>
              </CardHeader>
              <CardBody className="space-y-3">
                {integrityError && <div className="text-sm text-[var(--color-err)]">{integrityError}</div>}
                {integrityReport && integrityReport.subnetConflicts.length === 0 && integrityReport.assignmentReferences.length === 0 ? (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 px-3 py-2 text-sm text-[var(--color-ok)]">{t("No IPAM integrity issues detected.")}</div>
                ) : null}
                {integrityReport?.subnetConflicts.map((issue) => (
                  <div key={issue.id} className="rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-[var(--color-fg)]">{issue.name} · {issue.cidr}</div>
                        <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                          {issue.integrity.state === "invalid-cidr"
                            ? "Invalid legacy CIDR"
                            : `Overlaps ${issue.integrity.conflicts.map((conflict) => conflict.cidr).join(", ")}`}
                          {` · ${issue.childCounts.assignments} assignments · ${issue.childCounts.dhcpScopes} scopes · ${issue.childCounts.zones} zones`}
                        </div>
                      </div>
                      <a className="text-xs font-medium text-[var(--color-accent)] hover:underline" href={`/networks?subnetId=${encodeURIComponent(issue.id)}`}>{t("Repair subnet")}</a>
                    </div>
                  </div>
                ))}
                {integrityReport?.assignmentReferences.map((issue) => (
                  <div key={issue.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-err)]/25 bg-[var(--color-err)]/10 p-3 text-sm">
                    <div>
                      <div className="font-medium text-[var(--color-fg)]">{issue.ipAddress}</div>
                      <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                        {issue.integrity.state} · {issue.integrity.fields.join(", ")}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void clearInvalidAssignmentReferences(issue)}>{t("Clear invalid references")}</Button>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Admin")}</CardLabel>
                  <CardHeading>{t("Language & regional settings")}</CardHeading>
                </CardTitle>
                <Badge tone="info">
                  <Languages className="size-3" />
                  {LANGUAGE_NATIVE_NAMES[language]}
                </Badge>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <LanguageSelector label={t("This browser")} />
                  <Field label={t("Instance default")}>
                    <select
                      value={defaultLanguage}
                      onChange={(event) =>
                        setDefaultLanguage(
                          event.target.value as SupportedLanguage,
                        )
                      }
                      className="rk-control h-8 w-full rounded-[var(--radius-sm)] px-2.5 text-sm text-[var(--text-primary)] focus-visible:outline-none"
                      aria-label={t("Default language")}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.nativeName}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="text-sm text-[var(--color-fg-subtle)]">
                  {t(
                    "This browser changes immediately. The instance default is used for new browsers before they choose a language.",
                  )}
                </div>
                {languageError && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {languageError}
                  </div>
                )}
                {languageSuccess && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 px-3 py-2 text-sm text-[var(--color-ok)]">
                    {languageSuccess}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleSaveLanguage()}
                    disabled={languageSaving}
                  >
                    <Save className="size-3.5" />
                    {languageSaving ? t("Saving...") : t("Save language")}
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>
                    {creating ? "New account" : "User details"}
                  </CardLabel>
                  <CardHeading>
                    {creating
                      ? "Create user"
                      : (selectedUser?.displayName ?? "Select a user")}
                  </CardHeading>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      form.role === "admin"
                        ? "accent"
                        : form.role === "editor"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {roleChipLabel(form.role, t)}
                  </Badge>
                  {selectedUser && (
                    <>
                      <Badge
                        tone={
                          selectedUser.authProvider === "oidc"
                            ? "info"
                            : "neutral"
                        }
                      >
                        {selectedUser.authProvider === "oidc" ? "oidc" : "local"}
                      </Badge>
                      <Badge tone={selectedUser.disabled ? "err" : "ok"}>
                        {selectedUser.disabled ? "disabled" : "active"}
                      </Badge>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardBody className="space-y-4">
                {selectedUser || creating ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Username">
                        <Input
                          value={form.username}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              username: event.target.value,
                            }))
                          }
                          placeholder={t("username")}
                        />
                      </Field>
                      <Field label="Display name">
                        <Input
                          value={form.displayName}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              displayName: event.target.value,
                            }))
                          }
                          placeholder={t("Display name")}
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={creating ? "Password" : "Reset password"}>
                        <Input
                          type="password"
                          value={form.password}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              password: event.target.value,
                            }))
                          }
                          placeholder={
                            creating
                              ? "At least 10 characters"
                              : "Leave blank to keep current password"
                          }
                        />
                      </Field>
                      <Field label={t("Role")}>
                        <RolePicker
                          value={form.role}
                          onChange={(role) =>
                            setForm((prev) => ({
                              ...prev,
                              role,
                              labRoles:
                                role === "admin"
                                  ? {}
                                  : defaultLabRoles(labs, role),
                            }))
                          }
                        />
                      </Field>
                    </div>

                    {form.role !== "admin" && labs.length > 0 && (
                      <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                        <div>
                          <div className="text-sm font-medium text-[var(--color-fg)]">
                            {t("Lab access")}
                          </div>
                          <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                            {t(
                              "Choose which labs this user can access and their role in each lab.",
                            )}
                          </p>
                        </div>
                        <div className="space-y-2">
                          {labs.map((lab) => (
                            <label
                              key={lab.id}
                              className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 md:grid-cols-[minmax(0,1fr)_160px]"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm text-[var(--color-fg)]">
                                  {lab.name}
                                </div>
                                {lab.location && (
                                  <div className="truncate text-xs text-[var(--color-fg-subtle)]">
                                    {lab.location}
                                  </div>
                                )}
                              </div>
                              <select
                                className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 text-sm text-[var(--color-fg)]"
                                value={form.labRoles[lab.id] ?? "none"}
                                onChange={(event) => {
                                  const value = event.target.value as LabRole | "none";
                                  setForm((prev) => ({
                                    ...prev,
                                    labRoles: {
                                      ...prev.labRoles,
                                      [lab.id]: value,
                                    },
                                  }));
                                }}
                              >
                                <option value="none">{t("No access")}</option>
                                <option value="viewer">{t("Can view")}</option>
                                <option value="editor">{t("Can edit")}</option>
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {form.role === "admin" && (
                      <p className="text-xs text-[var(--color-fg-subtle)]">
                        {t("Administrators can access all labs.")}
                      </p>
                    )}

                    <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                      <input
                        type="checkbox"
                        checked={form.disabled}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            disabled: event.target.checked,
                          }))
                        }
                      />
                      Disable this account
                    </label>

                    {selectedUser && (
                      <div className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4 md:grid-cols-2">
                        <Stat
                          label="Auth source"
                          value={
                            selectedUser.authProvider === "oidc"
                              ? `OIDC${selectedUser.oidcIssuer ? ` | ${selectedUser.oidcIssuer}` : ""}`
                              : "Local password"
                          }
                        />
                        <Stat
                          label="Created"
                          value={new Date(
                            selectedUser.createdAt,
                          ).toLocaleString()}
                        />
                        <Stat
                          label="Last login"
                          value={
                            selectedUser.lastLoginAt
                              ? new Date(
                                  selectedUser.lastLoginAt,
                                ).toLocaleString()
                              : "Never"
                          }
                        />
                      </div>
                    )}

                    {error && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                        {error}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                        <UserRound className="size-3.5" />
                        Viewer is read-only, editor can manage inventory, admin
                        can manage users and backups.
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedUser && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDelete()}
                            disabled={deleting}
                          >
                            <Trash2 className="size-3.5" />
                            {deleting ? "Deleting..." : "Delete"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => void handleSave()}
                          disabled={saving}
                        >
                          <Save className="size-3.5" />
                          {saving
                            ? "Saving..."
                            : creating
                              ? "Create user"
                              : "Save changes"}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title={t(
                      "Select an account from the left or create a new one.",
                    )}
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Operations")}</CardLabel>
                  <CardHeading>{t("Backup and release state")}</CardHeading>
                </CardTitle>
                <Badge tone="accent">{APP_VERSION_LABEL}</Badge>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">{t("Export snapshot")}</div>
                  <div className="mt-2 text-sm text-[var(--color-fg)]">{t("Download a full JSON backup of racks, devices, ports, cables, VLANs, IPAM, monitors, audit history, and user accounts.")}</div>
                  <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">{t("Backups include password hashes for local users, so keep the file somewhere private.")}</div>
                </div>

                {exportError && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {exportError}
                  </div>
                )}

                {exportSuccess && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 px-3 py-2 text-sm text-[var(--color-ok)]">
                    {exportSuccess}
                  </div>
                )}

                <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">{t("Restore snapshot")}</div>
                  <div className="mt-2 text-sm text-[var(--color-fg)]">{t("Import a Rackpad JSON backup and replace the current database contents.")}</div>
                  <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">{t("Restoring signs out the current session and reloads the restored users, templates, inventory, IPAM, and audit data.")}</div>
                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                    <input
                      type="file"
                      accept="application/json"
                      onChange={(event) => {
                        setRestoreFile(event.target.files?.[0] ?? null);
                        setRestoreError("");
                      }}
                      className="block w-full text-sm text-[var(--color-fg-subtle)] file:mr-3 file:rounded-[var(--radius-xs)] file:border file:border-[var(--color-line)] file:bg-[var(--color-surface)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-fg)]"
                    />
                    <Button
                      size="sm"
                      onClick={() => void handleRestore()}
                      disabled={restoring || !restoreFile}
                    >
                      <Upload className="size-3.5" />
                      {restoring ? "Restoring..." : "Restore backup"}
                    </Button>
                  </div>
                  {restoreFile && (
                    <div className="mt-2 text-xs text-[var(--color-fg-subtle)]">
                      Selected: {restoreFile.name}
                    </div>
                  )}
                </div>

                {restoreError && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {restoreError}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--color-fg-subtle)]">{t("Use this before Docker updates or test-database resets so you have a clean checkpoint.")}</div>
                  <Button
                    size="sm"
                    onClick={() => void handleExport()}
                    disabled={exporting}
                  >
                    <Download className="size-3.5" />
                    {exporting ? "Preparing..." : "Download backup"}
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Alerting")}</CardLabel>
                  <CardHeading>{t("Monitor notifications")}</CardHeading>
                </CardTitle>
                <Badge tone="info">
                  <BellRing className="size-3" />
                  Discord / Telegram / Email
                </Badge>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="text-sm text-[var(--color-fg-subtle)]">{t("Rackpad can alert when targets go down, when they recover, and when they stay offline long enough to need another reminder.")}</div>

                <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                  <input
                    type="checkbox"
                    checked={alertSettings.enabled}
                    onChange={(event) =>
                      setAlertSettings((prev) => ({
                        ...prev,
                        enabled: event.target.checked,
                      }))
                    }
                    disabled={alertsLoading}
                  />
                  Enable notifications
                </label>

                <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                  <input
                    type="checkbox"
                    checked={alertSettings.notifyOnDown}
                    onChange={(event) =>
                      setAlertSettings((prev) => ({
                        ...prev,
                        notifyOnDown: event.target.checked,
                      }))
                    }
                    disabled={alertsLoading}
                  />
                  Notify when a device or monitor target goes down
                </label>

                <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                  <input
                    type="checkbox"
                    checked={alertSettings.notifyOnRecovery}
                    onChange={(event) =>
                      setAlertSettings((prev) => ({
                        ...prev,
                        notifyOnRecovery: event.target.checked,
                      }))
                    }
                    disabled={alertsLoading}
                  />
                  Notify again when a device recovers
                </label>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                  <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                    <input
                      type="checkbox"
                      checked={alertSettings.repeatWhileOffline}
                      onChange={(event) =>
                        setAlertSettings((prev) => ({
                          ...prev,
                          repeatWhileOffline: event.target.checked,
                        }))
                      }
                      disabled={alertsLoading}
                    />
                    Repeat reminders while a target stays offline
                  </label>
                  <Field label="Repeat every (minutes)">
                    <Input
                      type="number"
                      min={1}
                      value={String(alertSettings.repeatIntervalMinutes)}
                      onChange={(event) =>
                        setAlertSettings((prev) => ({
                          ...prev,
                          repeatIntervalMinutes: Math.max(
                            1,
                            Number.parseInt(event.target.value, 10) || 60,
                          ),
                        }))
                      }
                      disabled={
                        alertsLoading || !alertSettings.repeatWhileOffline
                      }
                    />
                  </Field>
                </div>

                <Field label="Discord webhook URL">
                  <Input
                    value={alertSettings.discordWebhookUrl ?? ""}
                    onChange={(event) =>
                      setAlertSettings((prev) => ({
                        ...prev,
                        discordWebhookUrl: event.target.value || null,
                      }))
                    }
                    placeholder={t("https://discord.com/api/webhooks/...")}
                    disabled={alertsLoading}
                  />
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Telegram bot token">
                    <Input
                      value={alertSettings.telegramBotToken ?? ""}
                      onChange={(event) =>
                        setAlertSettings((prev) => ({
                          ...prev,
                          telegramBotToken: event.target.value || null,
                        }))
                      }
                      placeholder={t("123456:ABCDEF...")}
                      disabled={alertsLoading}
                    />
                  </Field>
                  <Field label="Telegram chat ID">
                    <Input
                      value={alertSettings.telegramChatId ?? ""}
                      onChange={(event) =>
                        setAlertSettings((prev) => ({
                          ...prev,
                          telegramChatId: event.target.value || null,
                        }))
                      }
                      placeholder="-1001234567890"
                      disabled={alertsLoading}
                    />
                  </Field>
                </div>

                <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">{t("SMTP / Email")}</div>
                      <div className="mt-1 text-sm text-[var(--color-fg-subtle)]">{t("Recipients can be comma or newline separated.")}</div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-fg)]">
                      <input
                        type="checkbox"
                        checked={alertSettings.smtpSecure}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpSecure: event.target.checked,
                          }))
                        }
                        disabled={alertsLoading}
                      />
                      SSL/TLS
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="SMTP host">
                      <Input
                        value={alertSettings.smtpHost ?? ""}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpHost: event.target.value || null,
                          }))
                        }
                        placeholder={t("smtp.example.com")}
                        disabled={alertsLoading}
                      />
                    </Field>
                    <Field label="SMTP port">
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={String(alertSettings.smtpPort ?? 587)}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpPort:
                              Number.parseInt(event.target.value, 10) || null,
                          }))
                        }
                        placeholder="587"
                        disabled={alertsLoading}
                      />
                    </Field>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="SMTP username">
                      <Input
                        value={alertSettings.smtpUsername ?? ""}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpUsername: event.target.value || null,
                          }))
                        }
                        placeholder={t("username")}
                        disabled={alertsLoading}
                      />
                    </Field>
                    <Field label="SMTP password">
                      <Input
                        type="password"
                        value={alertSettings.smtpPassword ?? ""}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpPassword: event.target.value || null,
                          }))
                        }
                        placeholder={t("password or app password")}
                        disabled={alertsLoading}
                      />
                    </Field>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="From address">
                      <Input
                        value={alertSettings.smtpFrom ?? ""}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpFrom: event.target.value || null,
                          }))
                        }
                        placeholder={t("rackpad@example.com")}
                        disabled={alertsLoading}
                      />
                    </Field>
                    <Field label="Recipients">
                      <textarea
                        value={alertSettings.smtpTo ?? ""}
                        onChange={(event) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            smtpTo: event.target.value || null,
                          }))
                        }
                        placeholder={"ops@example.com, noc@example.com"}
                        rows={3}
                        disabled={alertsLoading}
                        className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
                      />
                    </Field>
                  </div>
                </div>

                {alertError && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {alertError}
                  </div>
                )}

                {alertSuccess && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 px-3 py-2 text-sm text-[var(--color-ok)]">
                    {alertSuccess}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--color-fg-subtle)]">{t("Configure at least one channel, then save before sending a test alert.")}</div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestAlert()}
                      disabled={alertsLoading || alertTesting}
                    >
                      <BellRing className="size-3.5" />
                      {alertTesting ? "Sending..." : "Send test"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSaveAlerts()}
                      disabled={alertsLoading || alertSaving}
                    >
                      <Save className="size-3.5" />
                      {alertSaving ? "Saving..." : "Save notifications"}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Alerting")}</CardLabel>
                  <CardHeading>{t("Recent alert activity")}</CardHeading>
                </CardTitle>
                <Badge tone="neutral">{alertHistory.length} entries</Badge>
              </CardHeader>
              <CardBody>
                {alertHistoryError && (
                  <div className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {alertHistoryError}
                  </div>
                )}

                {alertHistoryLoading ? (
                  <div className="text-sm text-[var(--color-fg-subtle)]">{t("Loading alert history...")}</div>
                ) : alertHistory.length === 0 ? (
                  <EmptyState title={t("No alert activity recorded yet.")} />
                ) : (
                  <ul className="divide-y divide-[var(--color-line)] rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)]">
                    {alertHistory.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[var(--color-fg)]">
                            {entry.summary}
                          </div>
                          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                            {entry.action}
                            <span className="mx-1.5 text-[var(--color-fg-faint)]">
                              |
                            </span>
                            {entry.user}
                          </div>
                        </div>
                        <div className="whitespace-nowrap text-xs text-[var(--color-fg-subtle)]">
                          {new Date(entry.ts).toLocaleString()}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function RolePicker({
  value,
  onChange,
}: {
  value: UserRole;
  onChange: (value: UserRole) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["viewer", "editor", "admin"] as const).map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => onChange(role)}
          className={`rounded-[var(--radius-xs)] border px-2 py-2 text-xs capitalize transition-colors ${
            value === role
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
              : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
          }`}
        >
          <span className="inline-flex items-center gap-1">
            <Shield className="size-3.5" />
            {roleChipLabel(role, t)}
          </span>
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-1 text-sm text-[var(--color-fg)]">{value}</div>
    </div>
  );
}
