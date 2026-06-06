import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  bootstrapAdmin,
  initializeApp,
  login,
  startOidcLogin,
  useStore,
} from "@/lib/store";
import { LanguageSelector, useI18n } from "@/i18n";

type Mode = "login" | "bootstrap";

export function AuthScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const needsBootstrap = useStore((s) => s.needsBootstrap);
  const authLoading = useStore((s) => s.authLoading);
  const authError = useStore((s) => s.authError);
  const oidc = useStore((s) => s.oidc);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [bootstrapForm, setBootstrapForm] = useState({
    username: "",
    displayName: "",
    password: "",
    loadDemoData: false,
  });
  const mode: Mode = needsBootstrap ? "bootstrap" : "login";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (mode === "bootstrap") {
      await bootstrapAdmin({
        username: bootstrapForm.username.trim(),
        displayName: bootstrapForm.displayName.trim() || undefined,
        password: bootstrapForm.password,
        loadDemoData: bootstrapForm.loadDemoData,
      });
      navigate("/", { replace: true });
      return;
    }

    await login({
      username: loginForm.username.trim(),
      password: loginForm.password,
    });
    navigate("/", { replace: true });
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <Card className="w-full max-w-lg overflow-hidden">
        <div className="h-0.5 bg-[var(--accent-primary)] opacity-80" />
        <CardHeader className="border-b border-[var(--color-line)]">
          <CardTitle>
            <CardHeading className="text-[15px]">
              {mode === "bootstrap"
                ? t("Create your admin account")
                : t("Sign in to Rackpad")}
            </CardHeading>
            <p className="text-[13px] text-[var(--text-tertiary)]">
              {mode === "bootstrap"
                ? t("Set up the first account to get started.")
                : t("Welcome back.")}
            </p>
          </CardTitle>
          <LanguageSelector className="w-36" />
        </CardHeader>
        <CardBody>
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
          >
            {mode === "bootstrap" ? (
              <>
                <Field label={t("Username")}>
                  <Input
                    autoFocus
                    value={bootstrapForm.username}
                    onChange={(event) =>
                      setBootstrapForm((prev) => ({
                        ...prev,
                        username: event.target.value,
                      }))
                    }
                    placeholder="admin"
                  />
                </Field>
                <Field label={t("Display name")}>
                  <Input
                    value={bootstrapForm.displayName}
                    onChange={(event) =>
                      setBootstrapForm((prev) => ({
                        ...prev,
                        displayName: event.target.value,
                      }))
                    }
                    placeholder={t("Home Lab Admin")}
                  />
                </Field>
                <Field label={t("Password")}>
                  <Input
                    type="password"
                    value={bootstrapForm.password}
                    onChange={(event) =>
                      setBootstrapForm((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    placeholder={t("At least 10 characters")}
                  />
                </Field>
                <Field label={t("Initial data")}>
                  <div className="grid gap-2 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() =>
                        setBootstrapForm((prev) => ({
                          ...prev,
                          loadDemoData: false,
                        }))
                      }
                      className={`rounded-[var(--radius-sm)] border px-3 py-3 text-left transition-colors ${
                        !bootstrapForm.loadDemoData
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-fg)]"
                          : "border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-fg-subtle)] hover:border-[var(--color-line-strong)]"
                      }`}
                    >
                      <div className="font-medium">{t("Start empty")}</div>
                      <div className="mt-1 text-xs">
                        {t(
                          "Create a clean lab with no sample racks, devices, VLANs, or IPAM data.",
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBootstrapForm((prev) => ({
                          ...prev,
                          loadDemoData: true,
                        }))
                      }
                      className={`rounded-[var(--radius-sm)] border px-3 py-3 text-left transition-colors ${
                        bootstrapForm.loadDemoData
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-fg)]"
                          : "border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-fg-subtle)] hover:border-[var(--color-line-strong)]"
                      }`}
                    >
                      <div className="font-medium">{t("Load demo data")}</div>
                      <div className="mt-1 text-xs">
                        {t(
                          "Preload a complete sample environment with multiple labs, racks, WiFi, discovery findings, VMs, and monitoring targets.",
                        )}
                      </div>
                    </button>
                  </div>
                </Field>
                {oidc.enabled && (
                  <>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-faint)]">
                      <div className="h-px flex-1 bg-[var(--color-line)]" />
                      <span>{t("or")}</span>
                      <div className="h-px flex-1 bg-[var(--color-line)]" />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => startOidcLogin("/")}
                    >
                      {t("Continue with {label}", { label: oidc.label })}
                    </Button>
                  </>
                )}
              </>
            ) : (
              <>
                {oidc.enabled && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => startOidcLogin("/")}
                    >
                      {t("Continue with {label}", { label: oidc.label })}
                    </Button>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-faint)]">
                      <div className="h-px flex-1 bg-[var(--color-line)]" />
                      <span>{t("or")}</span>
                      <div className="h-px flex-1 bg-[var(--color-line)]" />
                    </div>
                  </>
                )}
                <Field label={t("Username")}>
                  <Input
                    autoFocus
                    value={loginForm.username}
                    onChange={(event) =>
                      setLoginForm((prev) => ({
                        ...prev,
                        username: event.target.value,
                      }))
                    }
                    placeholder="admin"
                  />
                </Field>
                <Field label={t("Password")}>
                  <Input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) =>
                      setLoginForm((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    placeholder={t("Your account password")}
                  />
                </Field>
              </>
            )}

            {authError && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                {authError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void initializeApp(true)}
                className="text-[13px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {mode === "bootstrap" ? t("Go to sign in") : t("Refresh")}
              </button>
              <Button type="submit" disabled={authLoading}>
                {authLoading
                  ? mode === "bootstrap"
                    ? t("Creating account...")
                    : t("Signing in...")
                  : mode === "bootstrap"
                    ? t("Create admin account")
                    : t("Sign in")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
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
