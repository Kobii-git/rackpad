import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api, type McpProposalRecord, type McpTokenRecord } from "@/lib/api";
import { loadAll, useStore } from "@/lib/store";
import { useI18n } from "@/i18n";

export default function McpPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id: reviewId } = useParams<{ id: string }>();
  const labs = useStore((state) => state.labs);
  const user = useStore((state) => state.currentUser);
  const [tokens, setTokens] = useState<McpTokenRecord[]>([]);
  const [proposals, setProposals] = useState<McpProposalRecord[]>([]);
  const [review, setReview] = useState<McpProposalRecord | null>(null);
  const [name, setName] = useState("");
  const [capability, setCapability] = useState<"read" | "write">("read");
  const [labIds, setLabIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [nextTokens, nextProposals] = await Promise.all([api.listMcpTokens(), api.listMcpProposals()]);
    setTokens(nextTokens);
    setProposals(nextProposals);
  }, []);

  useEffect(() => {
    void refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [refresh]);

  useEffect(() => {
    if (!reviewId) { setReview(null); return; }
    void api.getMcpProposal(reviewId).then(setReview).catch((caught: unknown) => {
      setReview(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, [reviewId]);

  const allowedLabs = labs.filter((lab) => capability === "read" || user?.role === "admin" ||
    user?.labAccess?.some((entry) => entry.labId === lab.id && entry.role === "editor"));

  async function createToken() {
    setBusy(true);
    setError("");
    try {
      const token = await api.createMcpToken({ name, capability, labIds, expiresInDays });
      setIssuedToken(token.token);
      setName("");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  async function revokeToken(id: string) {
    setBusy(true);
    setError("");
    try { await api.revokeMcpToken(id); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      await api.applyMcpProposal(review.id);
      setReview(null);
      navigate("/mcp");
      await loadAll(true);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar title={t("MCP")} subtitle={t("Lab access")} />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 xl:p-6">
        {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        {reviewId && (
          <section className="rk-panel space-y-3 rounded-[var(--radius-md)] p-4" data-testid="mcp-review">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{t("MCP")} · {t("Review")}</h2>
              <Link to="/mcp" className="text-sm underline">{t("Close")}</Link>
            </div>
            {review && <>
              <div className="text-xs text-[var(--text-secondary)]">
                {t("Lab")}: {labs.find((lab) => lab.id === review.labId)?.name ?? review.labId} · {review.expiresAt}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <span>{t("Racks")}: {review.summary.racks.length}</span>
                <span>{t("Devices")}: {review.summary.devices.length}</span>
                <span>{t("Ports")}: {review.summary.ports.length}</span>
                <span>{t("Connections")}: {review.summary.connections.length}</span>
              </div>
              <pre className="max-h-80 overflow-auto rounded bg-[var(--surface-2)] p-3 text-xs" data-testid="mcp-review-batch">
                {JSON.stringify(review.batch, null, 2)}
              </pre>
              {review.summary.warnings.map((warning) => <p key={warning} role="alert">{warning}</p>)}
              <Button onClick={() => void apply()} disabled={busy || user?.role === "viewer"} data-testid="mcp-apply">
                {busy ? t("Applying...") : t("Apply")}
              </Button>
            </>}
          </section>
        )}
        <section className="rk-panel space-y-3 rounded-[var(--radius-md)] p-4">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" /> {t("MCP")}</h2>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_7rem_auto]">
            <label className="space-y-1 text-xs"><span>{t("Name")}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </label>
            <label className="space-y-1 text-xs"><span>{t("Lab permissions")}</span>
              <select className="rk-control h-10 w-full" value={capability} onChange={(event) => {
                setCapability(event.target.value as "read" | "write"); setLabIds([]);
              }}>
                <option value="read">{t("Viewer")}</option>
                <option value="write" disabled={user?.role === "viewer"}>{t("Editor")}</option>
              </select>
            </label>
            <label className="space-y-1 text-xs"><span>{t("Days")}</span>
              <Input type="number" min={1} max={30} value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value))} />
            </label>
            <Button className="self-end" disabled={busy || !name.trim() || !labIds.length}
              onClick={() => void createToken()}>{t("Create")}</Button>
          </div>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-2 text-xs">{t("Labs")}</legend>
            {allowedLabs.map((lab) => <label key={lab.id} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={labIds.includes(lab.id)} onChange={(event) => setLabIds((current) =>
                event.target.checked ? [...current, lab.id] : current.filter((id) => id !== lab.id))} />{lab.name}
            </label>)}
          </fieldset>
          {issuedToken && <div className="rounded border border-[var(--accent-primary-border)] p-3" data-testid="mcp-issued-token">
            <p className="mb-2 text-xs">{t("MCP")} · {t("Copy")}</p>
            <code className="block break-all text-xs">{issuedToken}</code>
            <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void navigator.clipboard.writeText(issuedToken)}>{t("Copy")}</Button>
              <Button size="sm" variant="outline" onClick={() => setIssuedToken(null)}>{t("Close")}</Button></div>
          </div>}
          <div className="space-y-2">{tokens.map((token) => <div key={token.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2 text-sm">
            <span>{token.name} · {token.capability === "read" ? t("Viewer") : t("Editor")} · {token.expiresAt}</span>
            {!token.revokedAt && <Button size="sm" variant="outline" disabled={busy} onClick={() => void revokeToken(token.id)}>{t("Delete")}</Button>}
          </div>)}</div>
        </section>
        <section className="rk-panel space-y-2 rounded-[var(--radius-md)] p-4">
          <h2 className="font-semibold">{t("MCP")} · {t("Review")}</h2>
          {proposals.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">{t("No results")}</p>}
          {proposals.map((proposal) => <div key={proposal.id} className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2 text-sm">
            <span>{labs.find((lab) => lab.id === proposal.labId)?.name ?? proposal.labId} · {proposal.expiresAt}</span>
            <Button size="sm" asChild><Link to={proposal.reviewLink}>{t("Review")}</Link></Button>
          </div>)}
        </section>
      </main>
    </div>
  );
}
