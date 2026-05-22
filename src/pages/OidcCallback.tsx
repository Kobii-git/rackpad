import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { completeOidcLogin } from "@/lib/store";

export default function OidcCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState(params.get("error"));

  useEffect(() => {
    const session = params.get("session");
    if (!session) {
      setError((prev) => prev ?? "OIDC sign-in did not return a session.");
      return;
    }

    void completeOidcLogin(session)
      .then((returnTo) => {
        navigate(returnTo || "/", { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "OIDC sign-in failed.");
      });
  }, [navigate, params]);

  return (
    <div className="rk-page-ambient flex h-screen items-center justify-center bg-[var(--bg-page)] px-6">
      <div className="rk-panel w-full max-w-md rounded-[var(--radius-lg)] p-6 text-center shadow-[var(--shadow-elev)]">
        <div className="rk-kicker">Rackpad</div>
        <h1 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
          {error ? "OIDC sign-in failed" : "Completing sign-in"}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">
          {error ?? "Verifying the provider response and opening your Rackpad session."}
        </p>
        {error && (
          <div className="mt-4 flex justify-center">
            <Button size="sm" onClick={() => navigate("/", { replace: true })}>
              Back to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
