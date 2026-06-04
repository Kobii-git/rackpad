import { useRef, useState } from "react";
import { Download, ExternalLink, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Mono } from "@/components/shared/Mono";
import {
  createReferenceImageRecord,
  deleteReferenceImageRecord,
} from "@/lib/store";
import type { RackFace, ReferenceImage } from "@/lib/types";
import {
  defaultImageLabel,
  imageSizeLimitLabel,
  readImageFileAsDataUrl,
} from "@/lib/image-data-url";
import { downloadImageAsset, openImageAsset } from "@/lib/image-actions";
import { relativeTime } from "@/lib/utils";

interface ReferenceImageGalleryProps {
  entityType: ReferenceImage["entityType"];
  entityId: string;
  images: ReferenceImage[];
  face?: RackFace;
  canEdit: boolean;
  compact?: boolean;
  emptyText?: string;
}

export function ReferenceImageGallery({
  entityType,
  entityId,
  images,
  face,
  canEdit,
  compact = false,
  emptyText = "No images attached yet.",
}: ReferenceImageGalleryProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const visibleImages =
    entityType === "rack" && face
      ? images.filter((image) => (image.face ?? "front") === face)
      : images;

  async function handleImageSelected(file: File | undefined) {
    if (!file || !canEdit) return;
    setSaving(true);
    setError("");
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      await createReferenceImageRecord({
        entityType,
        entityId,
        label: label.trim() || defaultImageLabel(file.name),
        fileName: file.name,
        mimeType: file.type,
        dataUrl,
        face,
        notes: notes.trim() || null,
      });
      setLabel("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add image.");
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(image: ReferenceImage) {
    if (!window.confirm(`Delete image ${image.label}?`)) return;
    setDeletingId(image.id);
    setError("");
    try {
      await deleteReferenceImageRecord(image.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete image.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Pictures</CardLabel>
          <CardHeading>
            {entityType === "rack" && face
              ? `${capitalize(face)} reference`
              : "Reference images"}
          </CardHeading>
        </CardTitle>
        <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
          {visibleImages.length}
        </Mono>
      </CardHeader>
      <CardBody className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) =>
            void handleImageSelected(event.target.files?.[0])
          }
        />

        {error && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
            {error}
          </div>
        )}

        {canEdit && (
          <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Label"
            />
            {!compact && (
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="rk-control rk-textarea min-h-20 w-full text-sm"
                placeholder="Notes"
              />
            )}
            <div className="flex items-center justify-between gap-3">
              <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                {imageSizeLimitLabel()} max
              </Mono>
              <Button
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={saving}
              >
                <ImagePlus className="size-3.5" />
                {saving ? "Adding..." : "Choose image"}
              </Button>
            </div>
          </div>
        )}

        {visibleImages.length === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] px-3 py-5 text-center text-sm text-[var(--color-fg-subtle)]">
            {emptyText}
          </div>
        ) : (
          <div className={compact ? "space-y-3" : "grid gap-3 md:grid-cols-2"}>
            {visibleImages.map((image) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)]"
              >
                <img
                  src={image.dataUrl}
                  alt={image.label}
                  className={
                    compact
                      ? "h-48 w-full bg-black/20 object-contain"
                      : "h-56 w-full bg-black/20 object-contain"
                  }
                  loading="lazy"
                />
                <div className="space-y-2 border-t border-[var(--color-line)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                        {image.label}
                      </div>
                      <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                        {relativeTime(image.createdAt)}
                      </Mono>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openImageAsset(image)}
                        aria-label={`Open ${image.label} larger`}
                      >
                        <ExternalLink />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => downloadImageAsset(image)}
                        aria-label={`Download ${image.label}`}
                      >
                        <Download />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleDelete(image)}
                          disabled={deletingId === image.id}
                          aria-label={`Delete ${image.label}`}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>
                  {image.notes && (
                    <div className="text-xs leading-5 text-[var(--color-fg-subtle)]">
                      {image.notes}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
