import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  assertLabReadFromRow,
  assertLabWriteFromRow,
} from "../lib/lab-access.js";
import { asObject, ValidationError } from "../lib/validation.js";
import {
  isStackType,
  listStackMembers,
  saveStackMember,
  reorderStackMembers,
  syncStackHeight,
} from "../lib/device-stacks.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";

type Params = { id: string; memberId: string };
export const deviceStacksRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: Params }>("/:id/stack-members", async (req, reply) => {
    const device = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabReadFromRow(req, reply, device)) return;
    return listStackMembers(req.params.id);
  });
  for (const method of ["POST", "PATCH", "DELETE", "PUT"] as const) {
    const url =
      method === "POST"
        ? "/:id/stack-members"
        : method === "PUT"
          ? "/:id/stack-members/order"
          : "/:id/stack-members/:memberId";
    app.route<{ Params: Params }>({
      method,
      url,
      handler: async (req, reply) => {
        const device = db
          .prepare("SELECT * FROM devices WHERE id = ?")
          .get(req.params.id) as Record<string, unknown> | undefined;
        if (!assertLabWriteFromRow(req, reply, device)) return;
        if (!isStackType(String(device!.deviceType)))
          throw new ValidationError(
            "This device is not a stacked switch.",
            409,
          );
        const result = db.transaction(() => {
          const members = listStackMembers(req.params.id);
          const existing = members.find(
            (row) => row.id === req.params.memberId,
          );
          if ((method === "PATCH" || method === "DELETE") && !existing)
            throw new ValidationError("Stack member not found.", 404);
          let result;
          if (method === "POST" || method === "PATCH")
            result = saveStackMember(
              req.params.id,
              asObject(req.body),
              existing,
            );
          else if (method === "PUT")
            reorderStackMembers(req.params.id, asObject(req.body).memberIds);
          else {
            if (
              db
                .prepare("SELECT id FROM ports WHERE stackMemberId = ? LIMIT 1")
                .get(existing!.id)
            )
              throw new ValidationError(
                "Unassign member ports before deleting this member.",
                409,
              );
            db.prepare("DELETE FROM deviceStackMembers WHERE id = ?").run(
              existing!.id,
            );
            // Compact remaining positions before validating the complete order.
            const remaining = listStackMembers(req.params.id);
            remaining.forEach((row, position) =>
              db
                .prepare(
                  "UPDATE deviceStackMembers SET position = ? WHERE id = ?",
                )
                .run(position, row.id),
            );
            syncStackHeight(req.params.id);
          }
          writeAuditLogEntry({
            user: req.authUser!.username,
            action: "device.stack.update",
            entityType: "Device",
            entityId: req.params.id,
            summary: `Updated stack members for ${String(device!.hostname)}`,
          });
          return result ?? listStackMembers(req.params.id);
        })();
        return reply
          .status(method === "POST" ? 201 : method === "DELETE" ? 204 : 200)
          .send(method === "DELETE" ? undefined : result);
      },
    });
  }
};
