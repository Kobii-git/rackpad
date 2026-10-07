import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { loadAll } from "@/lib/store";
import type {
  Device,
  DeviceStackMember,
  HardwareTemplateV1,
  Port,
  PortBindingV1,
  StackMemberLayoutPreview,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhysicalFaceplate } from "@/components/rack/PhysicalFaceplate";
import { deviceTypeChainIncludes } from "@/lib/device-types";
import { useStore } from "@/lib/store";

export function StackMemberLayoutEditor({
  device,
  member,
  ports,
  canEdit,
}: {
  device: Device;
  member: DeviceStackMember;
  ports: Port[];
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const deviceTypes = useStore((state) => state.deviceTypes);
  const [templates, setTemplates] = useState<HardwareTemplateV1[]>([]);
  const [templateId, setTemplateId] = useState(
    member.appliedLayout?.sourceTemplateId ?? "",
  );
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [unassignedPortIds, setUnassignedPortIds] = useState<string[]>([]);
  const [heightU, setHeightU] = useState(member.heightU);
  const [bindings, setBindings] = useState<PortBindingV1[] | undefined>();
  const [preview, setPreview] = useState<StackMemberLayoutPreview>();
  const [approved, setApproved] = useState<string[]>([]);
  const [acceptHeight, setAcceptHeight] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getHardwareTemplates(),
      api.getStackMemberLayout(device.id, member.id),
    ])
      .then(([result, applied]) => {
        if (!active) return;
        setTemplates(result.templates);
        if (applied) {
          setTemplateId(applied.sourceTemplateId);
          setModuleIds(applied.snapshot.moduleIds ?? []);
          setBindings(applied.bindings);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [device.id, member.id]);
  const template = templates.find((template) => template.id === templateId);
  const eligible = ports.filter(
    (port) =>
      port.portRole !== "aggregate" &&
      port.kind !== "virtual" &&
      port.kind !== "wifi" &&
      (port.stackMemberId === member.id || unassignedPortIds.includes(port.id)),
  );
  const invalidate = () => {
    setPreview(undefined);
    setApproved([]);
    setAcceptHeight(false);
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  if (!canEdit)
    return (
      <p>
        {t("Physical layout")}:{" "}
        {member.appliedLayout?.sourceTemplateId ?? t("Automatic")}
      </p>
    );
  return (
    <fieldset
      disabled={busy}
      className="mt-3 space-y-3"
      data-testid="stack-member-layout"
    >
      <legend>{t("Physical layout")}</legend>
      <p>{member.appliedLayout?.sourceTemplateId ?? t("Automatic")}</p>
      <label className="block">
        {t("Template library")}
        <select
          className="rk-control w-full"
          value={templateId}
          onChange={(event) => {
            setTemplateId(event.target.value);
            setModuleIds([]);
            setBindings(undefined);
            invalidate();
          }}
        >
          <option value="">{t("Select")}</option>
          {templates
            .filter(
              (template) =>
                !template.deviceTypes.length ||
                template.deviceTypes.some((type) =>
                  deviceTypeChainIncludes(device.deviceType, type, deviceTypes),
                ),
            )
            .map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
        </select>
      </label>
      {template?.modules.map((module) => (
        <label className="block" key={module.id}>
          <input
            type="checkbox"
            checked={moduleIds.includes(module.id)}
            onChange={(event) => {
              setModuleIds(
                event.target.checked
                  ? [...moduleIds, module.id]
                  : moduleIds.filter((id) => id !== module.id),
              );
              setBindings(undefined);
              invalidate();
            }}
          />{" "}
          {module.name}
        </label>
      ))}
      <label className="block">
        {t("Height (U)")}
        <Input
          type="number"
          min={1}
          max={20}
          value={heightU}
          onChange={(event) => {
            setHeightU(Number(event.target.value));
            invalidate();
          }}
        />
      </label>
      {template && (
        <p>
          {t("Template name")}: {template.name} ·{" "}
          {template.mountDefaults.heightU}
          {t("U")}
        </p>
      )}
      {ports.some(
        (port) =>
          !port.stackMemberId &&
          port.portRole !== "aggregate" &&
          port.kind !== "virtual" &&
          port.kind !== "wifi",
      ) && (
        <details>
          <summary>{t("Stack-wide ports")}</summary>
          {ports
            .filter(
              (port) =>
                !port.stackMemberId &&
                port.portRole !== "aggregate" &&
                port.kind !== "virtual" &&
                port.kind !== "wifi",
            )
            .map((port) => (
              <label key={port.id} className="block">
                <input
                  type="checkbox"
                  checked={unassignedPortIds.includes(port.id)}
                  onChange={(event) => {
                    setUnassignedPortIds(
                      event.target.checked
                        ? [...unassignedPortIds, port.id]
                        : unassignedPortIds.filter((id) => id !== port.id),
                    );
                    setBindings(undefined);
                    invalidate();
                  }}
                />{" "}
                {port.name}
              </label>
            ))}
        </details>
      )}
      <Button
        disabled={!template || busy}
        onClick={() =>
          void run(async () => {
            const next = await api.previewStackMemberLayout(
              device.id,
              member.id,
              { templateId, moduleIds, unassignedPortIds, heightU, bindings },
            );
            setPreview(next);
            setApproved([]);
            setAcceptHeight(false);
          })
        }
      >
        {t("Preview")}
      </Button>
      {preview && (
        <div className="space-y-3">
          {(["front", "rear"] as const).map((face) => (
            <div key={face}>
              <p>{t(face === "front" ? "Front" : "Rear")}</p>
              <PhysicalFaceplate
                layout={{
                  snapshot: preview.snapshot,
                  bindings: preview.bindings,
                }}
                face={face}
                ports={ports}
              />
            </div>
          ))}
          {preview.snapshot.portSlots.map((slot) => (
            <label key={slot.id} className="block">
              {slot.label ?? slot.id}
              <select
                className="rk-control w-full"
                value={
                  preview.bindings.find((binding) => binding.slotId === slot.id)
                    ?.portId ?? ""
                }
                onChange={(event) => {
                  const next = preview.bindings.filter(
                    (binding) =>
                      binding.slotId !== slot.id &&
                      binding.portId !== event.target.value,
                  );
                  if (event.target.value)
                    next.push({ slotId: slot.id, portId: event.target.value });
                  setBindings(next);
                  invalidate();
                }}
              >
                <option value="">{t("Select")}</option>
                {eligible
                  .filter(
                    (port) =>
                      (port.face ?? "front") === slot.face &&
                      slot.acceptedPortKinds.includes(port.kind),
                  )
                  .map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {preview.unmappedPortIds.length > 0 && (
            <p>
              {t("Warning")} · {t("Ports")}:{" "}
              {preview.unmappedPortIds
                .map((id) => ports.find((port) => port.id === id)?.name ?? id)
                .join(", ")}
            </p>
          )}
          {preview.portsToCreate.map((port) => (
            <label key={port.slotId} className="block">
              <input
                type="checkbox"
                checked={approved.includes(port.slotId)}
                onChange={(event) =>
                  setApproved(
                    event.target.checked
                      ? [...approved, port.slotId]
                      : approved.filter((id) => id !== port.slotId),
                  )
                }
              />
              {t("Create")}: {port.name} · {port.kind}
            </label>
          ))}
          {preview.heightU !== preview.currentHeightU && (
            <label className="block">
              <input
                type="checkbox"
                checked={acceptHeight}
                onChange={(event) => setAcceptHeight(event.target.checked)}
              />
              {t("Height (U)")}: {preview.currentHeightU} → {preview.heightU}
            </label>
          )}
          {[
            ...preview.conflicts,
            ...preview.linkedUnmappedPortIds.map(
              (id) =>
                `${t("Ports linked")}: ${ports.find((port) => port.id === id)?.name ?? id}`,
            ),
          ].map((message) => (
            <p role="alert" key={message}>
              {message}
            </p>
          ))}
          <Button
            disabled={
              busy ||
              !!preview.conflicts.length ||
              !!preview.linkedUnmappedPortIds.length ||
              (preview.heightU !== preview.currentHeightU && !acceptHeight)
            }
            onClick={() =>
              void run(async () => {
                await api.applyStackMemberLayout(
                  preview,
                  approved,
                  acceptHeight,
                );
                await loadAll(true);
                invalidate();
                setBindings(undefined);
              })
            }
          >
            {t("Apply")}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
