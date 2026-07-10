import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FileText,
  ImagePlus,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MarkdownPreview } from "@/components/shared/MarkdownPreview";
import { Mono } from "@/components/shared/Mono";
import {
  canEditInventory,
  createDocumentationPageRecord,
  deleteDocumentationPageRecord,
  linkDocumentationDeviceRecord,
  unlinkDocumentationDeviceRecord,
  updateDocumentationPageRecord,
  useStore,
} from "@/lib/store";
import { api } from "@/lib/api";
import type { DocumentationDeviceLink } from "@/lib/types";
import {
  defaultImageLabel,
  imageSizeLimitLabel,
  readImageFileAsDataUrl,
} from "@/lib/image-data-url";
import { relativeTime } from "@/lib/utils";

const DOC_PRINT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function DocumentationView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const pages = useStore((s) => s.documentationPages);
  const devices = useStore((s) => s.devices);
  const canEdit = canEditInventory(currentUser);
  const [pageLinks, setPageLinks] = useState<DocumentationDeviceLink[]>([]);
  const [linkDeviceId, setLinkDeviceId] = useState("");
  const [query, setQuery] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPageId = searchParams.get("pageId") ?? "";
  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pages;
    return pages.filter((page) =>
      [page.title, page.content].join(" ").toLowerCase().includes(normalized),
    );
  }, [pages, query]);

  const selectedPage =
    pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const printStamp = DOC_PRINT_DATE_FORMAT.format(new Date());

  useEffect(() => {
    if (!selectedPage) return;
    if (selectedPage.id !== selectedPageId) {
      setSearchParams({ pageId: selectedPage.id }, { replace: true });
      return;
    }
    setDraftTitle(selectedPage.title);
    setDraftContent(selectedPage.content);
    setError("");
  }, [selectedPage, selectedPageId, setSearchParams]);

  useEffect(() => {
    if (!selectedPage) {
      setPageLinks([]);
      return;
    }
    void api
      .getDocumentationLinks({ pageId: selectedPage.id })
      .then(setPageLinks)
      .catch(() => setPageLinks([]));
  }, [selectedPage?.id]);

  const linkableDevices = useMemo(
    () => devices.filter((device) => device.labId === lab.id),
    [devices, lab.id],
  );

  async function handleLinkDevice() {
    if (!selectedPage || !linkDeviceId || !canEdit) return;
    const created = await linkDocumentationDeviceRecord(
      selectedPage.id,
      linkDeviceId,
    );
    setPageLinks((current) => [...current, created]);
    setLinkDeviceId("");
  }

  async function handleUnlinkDevice(deviceId: string) {
    if (!selectedPage || !canEdit) return;
    await unlinkDocumentationDeviceRecord(selectedPage.id, deviceId);
    setPageLinks((current) =>
      current.filter((link) => link.deviceId !== deviceId),
    );
  }

  async function handleCreate() {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      const created = await createDocumentationPageRecord({
        title: "New documentation",
        content: "",
      });
      setSearchParams({ pageId: created.id });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create documentation.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!selectedPage || !canEdit) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateDocumentationPageRecord(selectedPage.id, {
        title: draftTitle.trim() || "Untitled documentation",
        content: draftContent,
      });
      if (updated) setSearchParams({ pageId: updated.id }, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedPage || !canEdit) return;
    if (!window.confirm(t("Delete {title}?", { title: selectedPage.title })))
      return;
    setDeleting(true);
    setError("");
    try {
      await deleteDocumentationPageRecord(selectedPage.id);
      const nextPage = pages.find((page) => page.id !== selectedPage.id);
      if (nextPage) {
        setSearchParams({ pageId: nextPage.id }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete documentation.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleImageSelected(file: File | undefined) {
    if (!file || !canEdit) return;
    setError("");
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const imageMarkdown = `\n\n![${defaultImageLabel(file.name)}](${dataUrl})\n\n`;
      const editor = editorRef.current;
      if (!editor) {
        setDraftContent((current) => `${current}${imageMarkdown}`);
        return;
      }
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      setDraftContent(
        (current) =>
          `${current.slice(0, start)}${imageMarkdown}${current.slice(end)}`,
      );
      window.requestAnimationFrame(() => {
        editor.focus();
        const nextCursor = start + imageMarkdown.length;
        editor.setSelectionRange(nextCursor, nextCursor);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to insert image.");
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  return (
    <>
      <TopBar
        subtitle={lab.name}
        title={t("Documentation")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {pages.length} {t("pages")}
          </span>
        }
        actions={
          <>
            {selectedPage && (
              <Button
                variant="default"
                size="sm"
                onClick={() => window.print()}
              >
                <Printer className="size-3.5" />
                {t("Print / PDF")}
              </Button>
            )}
            {canEdit ? (
              <>
                {selectedPage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImagePlus className="size-3.5" />
                    {t("Insert image")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCreate()}
                  disabled={saving}
                >
                  <Plus className="size-3.5" />
                  {t("New page")}
                </Button>
                {selectedPage && (
                  <Button
                    size="sm"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    <Save className="size-3.5" />
                    {saving ? t("Saving...") : t("Save")}
                  </Button>
                )}
              </>
            ) : null}
          </>
        }
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => void handleImageSelected(event.target.files?.[0])}
      />

      <div className="docs-page flex flex-1 overflow-hidden">
        <aside className="screen-only flex w-64 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]/40">
          <div className="border-b border-[var(--color-line)] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search documentation...")}
                className="pl-7"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {filteredPages.map((page) => {
              const active = page.id === selectedPage?.id;
              return (
                <button
                  key={page.id}
                  onClick={() => setSearchParams({ pageId: page.id })}
                  className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
                      : "border-transparent hover:bg-[var(--color-surface)]/40"
                  }`}
                >
                  <div className="truncate text-xs font-medium text-[var(--color-fg)]">
                    {page.title}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                      {relativeTime(page.updatedAt)}
                    </Mono>
                    <Pencil className="size-3 text-[var(--color-fg-faint)]" />
                  </div>
                </button>
              );
            })}
            {filteredPages.length === 0 && (
              <div className="px-4 py-8 text-sm text-[var(--color-fg-subtle)]">
                {t("No matching pages.")}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden px-4 py-4">
          {!selectedPage ? (
            <Card className="mx-auto mt-16 max-w-xl">
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Documentation")}</CardLabel>
                  <CardHeading>{t("No pages yet")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody>
                {canEdit ? (
                  <EmptyState
                    icon={FileText}
                    title={t("No pages yet")}
                    action={
                      <Button onClick={() => void handleCreate()}>
                        <Plus className="size-3.5" />
                        {t("New page")}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={FileText}
                    title={t("No pages yet")}
                    description={t("Nothing documented yet.")}
                  />
                )}
              </CardBody>
            </Card>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-12 gap-4">
              <section className="docs-editor-pane screen-only col-span-12 flex min-h-0 xl:col-span-6">
                <Card className="flex min-h-0 w-full flex-col">
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>{t("Markdown")}</CardLabel>
                      <CardHeading>{t("Edit page")}</CardHeading>
                    </CardTitle>
                    {canEdit && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                      >
                        <Trash2 className="size-3.5" />
                        {deleting ? t("Deleting...") : t("Delete")}
                      </Button>
                    )}
                  </CardHeader>
                  <CardBody className="flex min-h-0 flex-1 flex-col gap-3">
                    {error && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                        {error}
                      </div>
                    )}
                    <Input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      disabled={!canEdit}
                    />
                    {canEdit && (
                      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                        <div className="rk-kicker">{t("Linked devices")}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {pageLinks.length === 0 ? (
                            <span className="text-xs text-[var(--text-tertiary)]">
                              {t("No linked devices yet.")}
                            </span>
                          ) : (
                            pageLinks.map((link) => {
                              const device = devices.find(
                                (entry) => entry.id === link.deviceId,
                              );
                              return (
                                <div
                                  key={link.id}
                                  className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-xs"
                                >
                                  <span>
                                    {device?.hostname ?? link.deviceId}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      void handleUnlinkDevice(link.deviceId)
                                    }
                                  >
                                    {t("Unlink documentation")}
                                  </Button>
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <label className="min-w-48 flex-1 space-y-1 text-sm">
                            <span className="text-[var(--text-secondary)]">
                              {t("Link device")}
                            </span>
                            <select
                              className="rk-control w-full"
                              value={linkDeviceId}
                              onChange={(event) =>
                                setLinkDeviceId(event.target.value)
                              }
                            >
                              <option value="">{t("Select a device")}</option>
                              {linkableDevices.map((device) => (
                                <option key={device.id} value={device.id}>
                                  {device.hostname}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!linkDeviceId}
                            onClick={() => void handleLinkDevice()}
                          >
                            {t("Link device")}
                          </Button>
                        </div>
                      </div>
                    )}
                    <textarea
                      ref={editorRef}
                      value={draftContent}
                      onChange={(event) => setDraftContent(event.target.value)}
                      disabled={!canEdit}
                      className="rk-control rk-textarea min-h-[640px] flex-1 resize-none font-mono text-xs leading-5 text-[var(--color-fg)] xl:min-h-0"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                        {t("Images up to")}
                        {imageSizeLimitLabel()}
                      </Mono>
                      {canEdit && (
                        <Button
                          size="sm"
                          onClick={() => void handleSave()}
                          disabled={saving}
                        >
                          <Save className="size-3.5" />
                          {saving ? t("Saving...") : t("Save")}
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </section>

              <section className="docs-print-preview col-span-12 flex min-h-0 xl:col-span-6">
                <Card className="flex min-h-0 w-full flex-col">
                  <CardHeader className="screen-only">
                    <CardTitle>
                      <CardLabel>{t("Preview")}</CardLabel>
                      <CardHeading>
                        {draftTitle || selectedPage.title}
                      </CardHeading>
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="min-h-[640px] flex-1 overflow-y-auto xl:min-h-0">
                    <div className="docs-print-header print-only">
                      <h1>{draftTitle || selectedPage.title}</h1>
                      <p>
                        {t("{lab} | generated {stamp}", {
                          lab: lab.name,
                          stamp: printStamp,
                        })}
                      </p>
                    </div>
                    <MarkdownPreview content={draftContent} />
                  </CardBody>
                </Card>
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
