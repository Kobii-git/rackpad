#!/usr/bin/env node
import { ESLint } from "eslint";

const eslint = new ESLint();

// Each probe proves that a real rule set reaches a distinct part of the tree.
// Without the server probe, narrowing the TypeScript block to `src/**` would
// silently drop linting for every server file while this proof still passed.
const probes = [
  {
    label: "React/TSX source",
    filePath: "src/__lint_gate_probe__.tsx",
    requiredRules: [
      "@typescript-eslint/no-unused-vars",
      "react-hooks/rules-of-hooks",
    ],
    code: `
      import { useEffect } from "react";

      const intentionallyUnused: number = 1;

      export function BrokenHookUsage({ enabled }: { enabled: boolean }) {
        if (enabled) {
          useEffect(() => undefined, []);
        }
        return null;
      }
    `,
  },
  {
    label: "server TypeScript",
    filePath: "server/__lint_gate_probe__.ts",
    requiredRules: ["@typescript-eslint/no-unused-vars"],
    code: `
      const intentionallyUnused: number = 1;

      export function probe(): string {
        return "probe";
      }
    `,
  },
  {
    label: "single Fastify application factory",
    filePath: "server/routes/__lint_gate_fastify_probe__.ts",
    requiredRules: ["no-restricted-imports"],
    code: `
      import Fastify from "fastify";

      export const app = Fastify();
    `,
  },
  {
    label: "repository scripts",
    filePath: "scripts/__lint_gate_probe__.mjs",
    requiredRules: ["no-undef"],
    code: `
      export const probe = definitelyNotDefined;
    `,
  },
];

const failures = [];

for (const probe of probes) {
  const [result] = await eslint.lintText(probe.code, {
    filePath: probe.filePath,
  });
  const rejectedBy = new Set(result.messages.map((message) => message.ruleId));
  const missingRules = probe.requiredRules.filter(
    (rule) => !rejectedBy.has(rule),
  );

  if (result.errorCount === 0) {
    failures.push(`${probe.label}: probe produced no lint error`);
    continue;
  }
  if (missingRules.length > 0) {
    failures.push(`${probe.label}: missing ${missingRules.join(", ")}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Lint gate coverage proof failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Lint gate proof passed: ${probes.length} probes rejected (${probes.map((probe) => probe.label).join(", ")}).`,
);
