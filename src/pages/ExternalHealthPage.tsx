import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { canEditInventory, useStore } from "@/lib/store";
import type { ExternalHealthView, IntegrationConnection } from "@/lib/types";
import { useI18n } from "@/i18n";

export default function ExternalHealthPage() {
  const { t } = useI18n();
  const lab = useStore(s => s.lab), user = useStore(s => s.currentUser), devices = useStore(s => s.devices);
  const [params, setParams] = useSearchParams();
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const requested = params.get("connectionId");
  const connection = connections.find(row => row.id === requested) ?? connections[0];
  const id = connection?.labId === lab.id ? connection.id : "";
  const canEdit = canEditInventory(user, lab.id);
  const [view, setView] = useState<ExternalHealthView>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [interval, setInterval] = useState(60), [polling, setPolling] = useState(false);
  const [targets, setTargets] = useState<Record<string,string>>({});
  const epoch = useRef(0), requestRevision = useRef(0), busyRef = useRef(false);
  useEffect(() => {
    let live = true;
    setConnections([]);
    Promise.all([api.getIntegrationConnections({labId: lab.id}), api.getIntegrationProviders()]).then(([rows, providers]) => {
      if (live) setConnections(rows.filter(row => providers.some(provider => provider.id === row.provider && provider.capabilities?.health)));
    }, () => { if(live) setError(t("Failed")); });
    return () => { live = false; };
  }, [lab.id,t]);
  useEffect(() => {
    const generation = ++epoch.current;
    setView(undefined); setBusy(false); busyRef.current = false; setError(""); setTargets({});
    let initialized = false;
    const accept = (next: ExternalHealthView) => {
      setView(next);
      if (!initialized) { initialized = true; setInterval(next.intervalSeconds); setPolling(next.pollingEnabled); }
    };
    const initialRevision = ++requestRevision.current;
    if(id) api.getExternalHealth(id).then(value => {
      if(epoch.current === generation && initialRevision === requestRevision.current) { accept(value); }
    }, () => { if(epoch.current === generation && initialRevision === requestRevision.current) setError(t("Failed")); });
    const timer = window.setInterval(() => {
      if (!id || busyRef.current) return;
      const revision = ++requestRevision.current;
      void api.getExternalHealth(id).then(next => {
        if (epoch.current === generation && revision === requestRevision.current && !busyRef.current) accept(next);
      }, () => { if(epoch.current === generation && revision === requestRevision.current) { setView(undefined); setError(t("Failed")); } });
    }, 10000);
    return () => { epoch.current = generation + 1; window.clearInterval(timer); };
  }, [id,t]);
  async function change(action: () => Promise<ExternalHealthView>) {
    const generation = epoch.current;
    busyRef.current = true; requestRevision.current++; setBusy(true); setError("");
    try { const next = await action(); if(epoch.current === generation) setView(next); }
    catch {
      try { const next = await api.getExternalHealth(id); if(epoch.current === generation) setView(next); }
      catch { if(epoch.current === generation) setView(undefined); }
      if(epoch.current === generation) setError(t("Failed"));
    }
    finally { if(epoch.current === generation) { busyRef.current = false; setBusy(false); } }
  }
  const recordIds = [...new Set(view?.readings.map(row => row.providerRecordId) ?? [])];
  const healthLabel = (health: string) => health === "healthy" ? t("Healthy") : health === "degraded" ? t("Degraded") : health === "unhealthy" ? t("Unhealthy") : t("Unknown");
  return <><TopBar title={t("External health")} /><main className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
    <p>{t("Read-only inventory and external health.")}</p>
    <p>{t("Readings affect health and alerts only through explicitly enabled monitors.")}</p>
    <Link to="/imports">{t("Imports")}</Link>
    <label className="block">{t("Connection")} <select aria-label={t("Connection")} value={id} onChange={event => setParams({connectionId:event.target.value})}>{connections.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    {view && <>
      <div className="flex flex-wrap gap-3 items-center">
        <Button disabled={!canEdit || busy || !connection?.enabled} onClick={() => void change(() => api.refreshExternalHealth(id))}>{t("Refresh")}</Button>
        <label><input type="checkbox" checked={polling} disabled={!canEdit || busy} onChange={event => setPolling(event.target.checked)} /> {t("Polling")}</label>
        <label>{t("Interval (seconds)")} <Input aria-label={t("Interval (seconds)")} type="number" min={60} max={3600} value={interval} disabled={!canEdit || busy} onChange={event => setInterval(Number(event.target.value))} /></label>
        <Button disabled={!canEdit || busy || interval < 60 || interval > 3600 || !Number.isInteger(interval)} onClick={() => void change(() => api.setExternalPolling(id,polling,interval))}>{t("Save")}</Button>
      </div>
      {view.error && <p role="status">{t("Failed")} · {view.error}</p>}
      {recordIds.map(recordId => {
        const readings = view.readings.filter(row => row.providerRecordId === recordId), binding = view.bindings.find(row => row.providerRecordId === recordId);
        return <section key={recordId} className="border rounded p-3 space-y-3">
          <h2 className="font-semibold">{readings[0].recordName}</h2>
          <p className="font-mono text-xs">{recordId}</p>
          {binding && <Link to={`/devices/${binding.deviceId}`}>{devices.find(row => row.id === binding.deviceId)?.hostname ?? binding.deviceId}</Link>}
          {canEdit && <div className="flex flex-wrap gap-2">
            <label>{t("Device")} <select aria-label={t("Device")} value={targets[recordId] ?? binding?.deviceId ?? ""} disabled={busy} onChange={event => setTargets(prev => ({...prev,[recordId]:event.target.value}))}><option value="">{t("Select device")}</option>{devices.map(row => <option value={row.id} key={row.id}>{row.hostname}</option>)}</select></label>
            <Button disabled={busy || !(targets[recordId] ?? binding?.deviceId)} onClick={() => void change(() => api.bindExternalRecord(id,{providerRecordId:recordId,deviceId:targets[recordId] ?? binding!.deviceId,sourceIdentity:view.sourceIdentity,expectedDeviceId:binding?.deviceId}))}>{t("Bind device")}</Button>
            {binding && <Button disabled={busy} onClick={() => void change(() => api.unbindExternalRecord(id,binding.id,binding.deviceId))}>{t("Unbind")}</Button>}
          </div>}
          <div className="overflow-x-auto"><table className="w-full text-start"><thead><tr><th>{t("Name")}</th><th>{t("Value")}</th><th>{t("Status")}</th><th>{t("Last checked")}</th><th>{t("Monitoring")}</th></tr></thead><tbody>
            {readings.map(reading => {
              const monitor = view.monitors.find(row => row.bindingId === binding?.id && row.readingKey === reading.key);
              return <tr key={reading.key}><td>{reading.label}</td><td>{String(reading.value ?? "—")} {reading.unit}</td><td>{healthLabel(reading.health)} {reading.stale && t("Stale")}</td><td>{reading.observedAt}</td><td>{monitor ? <div className="space-y-1">
                <label><input type="checkbox" checked={monitor.enabled} disabled={!canEdit || busy} onChange={event => void change(() => api.updateExternalMonitor(id,monitor.id,{enabled:event.target.checked}))} /> {t("Enabled")}</label>
                <label className="block"><input type="checkbox" checked={monitor.alertOnDegraded} disabled={!canEdit || busy} onChange={event => void change(() => api.updateExternalMonitor(id,monitor.id,{alertOnDegraded:event.target.checked}))} /> {t("Alert on degraded")}</label>
              </div> : binding && canEdit && <Button disabled={busy} onClick={() => void change(() => api.createExternalMonitor(id,binding.id,reading.key))}>{t("Create monitor")}</Button>}</td></tr>;
            })}
          </tbody></table></div>
        </section>;
      })}
    </>}
  </main></>;
}
