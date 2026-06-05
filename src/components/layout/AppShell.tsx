import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { AuthScreen } from "@/components/shared/AuthScreen";
import { Button } from "@/components/ui/Button";
import { initializeApp, loadAll, useStore } from "@/lib/store";

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const authReady = useStore((s) => s.authReady);
  const authLoading = useStore((s) => s.authLoading);
  const currentUser = useStore((s) => s.currentUser);
  const loading = useStore((s) => s.loading);
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!authReady && !authLoading) {
      void initializeApp();
    }
  }, [authLoading, authReady]);

  useEffect(() => {
    if (currentUser && !loaded && !loading) {
      void loadAll();
    }
  }, [currentUser, loaded, loading]);

  const shellReady = authReady && !!currentUser;
  const showLoadingCard =
    !authReady || authLoading || (currentUser != null && !loaded);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="rk-page-ambient flex h-screen overflow-hidden bg-[var(--bg-page)]">
        {shellReady && <Sidebar onOpenSearch={() => setPaletteOpen(true)} />}
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {!authReady || !currentUser ? (
              showLoadingCard ? (
                <CenteredStatus
                  eyebrow="Rackpad"
                  title={authLoading ? "Signing in…" : "Starting up…"}
                  body="One moment."
                />
              ) : (
                <AuthScreen />
              )
            ) : !loaded ? (
              <CenteredStatus
                eyebrow="Rackpad"
                title={loading ? "Loading your lab…" : "Couldn't load data"}
                body={
                  loading
                    ? "Fetching your inventory."
                    : (error ?? "Something went wrong. Try again.")
                }
                action={
                  !loading ? (
                    <Button size="sm" onClick={() => void loadAll(true)}>
                      Retry
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
      {shellReady && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </TooltipProvider>
  );
}

function CenteredStatus({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="rk-panel w-full max-w-md rounded-[var(--radius-lg)] p-6 text-center shadow-[var(--shadow-elev)]">
        <div className="rk-kicker">{eyebrow}</div>
        <h2 className="mt-2 text-lg font-semibold tracking-normal text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">{body}</p>
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
