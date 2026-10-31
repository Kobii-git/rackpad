import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { api, type ReferenceLookupResult } from "@/lib/api";
import { loadAll } from "@/lib/store";
import { useI18n } from "@/i18n";

export default function ReferenceDetailPage() {
  const { reference } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [result, setResult] = useState<ReferenceLookupResult>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.lookupReference(reference || "").then(
      (value) => {
        if (active) setResult(value);
      },
      (failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : t("Failed"));
      },
    );
    return () => {
      active = false;
    };
  }, [reference, t]);
  async function open(labId: string, path: string) {
    try {
      await loadAll(true, labId);
      navigate(path);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Failed"));
    }
  }
  return (
    <div className="flex h-full flex-col">
      <TopBar title={t("Reference")} />
      <main className="space-y-4 overflow-auto p-6">
        <Link to="/labels">{t("Labels")}</Link>
        {error && <p role="alert">{error}</p>}
        {result && (
          <>
            <h2 className="text-xl">
              {t(result.kind === "device" ? "Device" : "Cable")}: {result.label}
            </h2>
            <code dir="ltr">{result.publicReference}</code>
            {result.kind === "device" && (
              <div>
                <Button
                  onClick={() =>
                    void open(
                      result.labIds[0],
                      `/devices/${encodeURIComponent(result.id)}`,
                    )
                  }
                >
                  {t("Device")}: {result.label}
                </Button>
              </div>
            )}
            {result.kind === "cable" && (
              <>
                <ul>
                  {result.endpoints.map((endpoint) => (
                    <li key={endpoint.portId}>
                      <Button
                        variant="link"
                        onClick={() =>
                          void open(
                            endpoint.labId,
                            `/devices/${encodeURIComponent(endpoint.deviceId)}`,
                          )
                        }
                      >
                        {endpoint.hostname}: {endpoint.portName}
                      </Button>
                    </li>
                  ))}
                </ul>
                {result.labIds.length === 1 && (
                  <Button
                    onClick={() =>
                      void open(
                        result.labIds[0],
                        `/cables?reference=${result.publicReference}`,
                      )
                    }
                  >
                    {t("Cable")}: {result.label}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
