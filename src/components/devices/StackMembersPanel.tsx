import { useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { loadAll } from "@/lib/store";
import type { Device, DeviceStackMember, Port } from "@/lib/types";
import type { TranslationKey } from "@/i18n/translations";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhysicalFaceplate } from "@/components/rack/PhysicalFaceplate";
import { useStore } from "@/lib/store";

const statuses: DeviceStackMember["status"][] = [
  "online",
  "offline",
  "warning",
  "unknown",
  "maintenance",
  "unmanaged",
];
const statusKeys: TranslationKey[] = [
  "Online",
  "Offline",
  "Warning",
  "Unknown",
  "Maintenance",
  "Unmanaged",
];
type Draft = Omit<DeviceStackMember, "id" | "deviceId" | "position">;
const blank = (): Draft => ({
  name: "",
  manufacturer: "",
  model: "",
  serial: "",
  heightU: 1,
  status: "unknown",
  notes: "",
  macs: [],
});

export function StackMembersPanel({
  device,
  ports,
  canEdit,
}: {
  device: Device;
  ports: Port[];
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const layouts = useStore((state) => state.physicalLayouts);
  const layout = layouts.find((row) => row.deviceId === device.id);
  const members = device.stackMembers ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>, close = false) {
    setBusy(true);
    setError("");
    try {
      await action();
      await loadAll(true);
      if (close) setEditing(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    const ids = members.map((row) => row.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(() => api.reorderStackMembers(device.id, ids));
  }
  const fields: Array<
    [
      keyof Pick<Draft, "name" | "manufacturer" | "model" | "serial">,
      TranslationKey,
    ]
  > = [
    ["name", "Name"],
    ["manufacturer", "Manufacturer"],
    ["model", "Model"],
    ["serial", "Serial number"],
  ];
  return (
    <section className="space-y-4" aria-label={t("Stack Members")}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("Stack Members")}</h2>
        {canEdit && (
          <Button
            disabled={busy}
            onClick={() => {
              setEditing("new");
              setDraft(blank());
            }}
          >
            {t("Add member")}
          </Button>
        )}
      </div>
      <p>
        {t("Stack height is calculated from its members.")}{" "}
        {device.heightU ?? 1}
        {t("U")}
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {layout && (
        <div className="max-w-3xl">
          <PhysicalFaceplate
            layout={layout}
            face={device.face ?? "front"}
            ports={ports}
          />
        </div>
      )}
      <ol className="space-y-2">
        {members.map((member, index) => (
          <li
            key={member.id}
            className="rounded border border-line p-3"
            data-testid="stack-member"
          >
            <div className="flex flex-wrap items-center gap-3">
              <strong>{member.name}</strong>
              <span>
                {member.heightU}
                {t("U")} · {t(statusKeys[statuses.indexOf(member.status)])}
              </span>
              <span>
                {member.manufacturer} {member.model} {member.serial}
              </span>
              {canEdit && (
                <>
                  <Button
                    disabled={busy || index === 0}
                    aria-label={t("Move {label} up", { label: member.name })}
                    onClick={() => move(index, -1)}
                  >
                    {t("Move up")}
                  </Button>
                  <Button
                    disabled={busy || index === members.length - 1}
                    aria-label={t("Move {label} down", { label: member.name })}
                    onClick={() => move(index, 1)}
                  >
                    {t("Move down")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditing(member.id);
                      setDraft({
                        ...member,
                        macs: member.macs.map((mac) => ({ ...mac })),
                      });
                    }}
                  >
                    {t("Edit")}
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      ports.some((port) => port.stackMemberId === member.id)
                    }
                    onClick={() =>
                      void run(() =>
                        api.deleteStackMember(device.id, member.id),
                      )
                    }
                  >
                    {t("Delete")}
                  </Button>
                </>
              )}
            </div>
            <p>{member.notes}</p>
            {member.macs.map((mac) => (
              <p key={mac.macAddress}>
                {mac.label}: <code>{mac.macAddress}</code>
              </p>
            ))}
          </li>
        ))}
      </ol>
      {editing && canEdit && (
        <form
          aria-label={t("Edit stack member")}
          className="space-y-3 rounded border border-line p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                editing === "new"
                  ? api.createStackMember(device.id, draft)
                  : api.updateStackMember(device.id, editing, draft),
              true,
            );
          }}
        >
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            {fields.map(([key, label]) => (
              <label key={key}>
                {t(label)}
                <Input
                  required={key === "name"}
                  maxLength={120}
                  value={draft[key] ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                />
              </label>
            ))}
            <label>
              {t("Height (U)")}
              <Input
                type="number"
                required
                min={1}
                max={20}
                value={draft.heightU}
                onChange={(event) =>
                  setDraft({ ...draft, heightU: Number(event.target.value) })
                }
              />
            </label>
            <label>
              {t("Status")}
              <select
                className="rk-control w-full"
                value={draft.status}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    status: event.target.value as Draft["status"],
                  })
                }
              >
                {statuses.map((value, index) => (
                  <option key={value} value={value}>
                    {t(statusKeys[index])}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              {t("Notes")}
              <textarea
                className="rk-control w-full"
                maxLength={2000}
                value={draft.notes ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </label>
            {draft.macs.map((mac, index) => (
              <div key={index} className="flex gap-2 sm:col-span-2">
                <label>
                  {t("Label")}
                  <Input
                    required
                    maxLength={120}
                    value={mac.label}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        macs: draft.macs.map((row, i) =>
                          i === index
                            ? { ...row, label: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  {t("MAC address")}
                  <Input
                    required
                    value={mac.macAddress}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        macs: draft.macs.map((row, i) =>
                          i === index
                            ? { ...row, macAddress: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                </label>
                <Button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      macs: draft.macs.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t("Delete")}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              disabled={draft.macs.length >= 64}
              onClick={() =>
                setDraft({
                  ...draft,
                  macs: [...draft.macs, { label: "", macAddress: "" }],
                })
              }
            >
              {t("Add MAC address")}
            </Button>
            <div className="flex gap-2">
              <Button type="submit">{t("Save")}</Button>
              <Button type="button" onClick={() => setEditing(null)}>
                {t("Cancel")}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <label>
        {t("Member filter")}
        <select
          className="rk-control ml-2"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">{t("All ports")}</option>
          <option value="">{t("Stack-wide ports")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <table className="w-full">
        <thead>
          <tr>
            <th scope="col">{t("Name")}</th>
            <th scope="col">{t("Stack member")}</th>
          </tr>
        </thead>
        <tbody>
          {ports
            .filter(
              (port) =>
                filter === "all" || (port.stackMemberId ?? "") === filter,
            )
            .map((port) => (
              <tr key={port.id}>
                <td>{port.name}</td>
                <td>
                  <select
                    aria-label={t("{value1}: {name}", {
                      value1: t("Stack member"),
                      name: port.name,
                    })}
                    className="rk-control w-full"
                    disabled={!canEdit || busy}
                    value={port.stackMemberId ?? ""}
                    onChange={(event) =>
                      void run(() =>
                        api.updatePort(port.id, {
                          stackMemberId: event.target.value || null,
                        }),
                      )
                    }
                  >
                    <option value="">{t("Stack-wide ports")}</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
