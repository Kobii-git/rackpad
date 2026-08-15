import { ValidationError } from "../validation.js";

// Minimal five-field cron (minute hour day-of-month month day-of-week)
// supporting "*", "a", "a-b", "*/n", "a-b/n", and comma lists. Matching is
// minute-granular. Day-of-month and day-of-week follow the classic cron OR
// rule: when both are restricted, either one matching makes the date match.
const FIELD_RANGES = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

export interface CronSchedule {
  expression: string;
  fields: [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(
  raw: string,
  range: (typeof FIELD_RANGES)[number],
): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  let restricted = false;

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      throw new ValidationError(
        `Cron ${range.name} field has an empty list entry.`,
      );
    }
    const stepMatch = trimmed.match(/^(.+?)\/(\d+)$/);
    const base = stepMatch ? stepMatch[1] : trimmed;
    const step = stepMatch ? Number.parseInt(stepMatch[2], 10) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new ValidationError(`Cron ${range.name} step must be at least 1.`);
    }

    let start: number;
    let end: number;
    if (base === "*") {
      start = range.min;
      end = range.max;
      if (stepMatch) restricted = true;
    } else {
      restricted = true;
      const rangeMatch = base.match(/^(\d+)(?:-(\d+))?$/);
      if (!rangeMatch) {
        throw new ValidationError(
          `Cron ${range.name} field "${trimmed}" is not valid.`,
        );
      }
      start = Number.parseInt(rangeMatch[1], 10);
      end = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : start;
    }

    if (start > end) {
      throw new ValidationError(
        `Cron ${range.name} range "${trimmed}" is reversed.`,
      );
    }
    if (start < range.min || end > range.max) {
      throw new ValidationError(
        `Cron ${range.name} field "${trimmed}" is outside ${range.min}-${range.max}.`,
      );
    }
    for (let value = start; value <= end; value += step) {
      // Cron treats both 0 and 7 as Sunday.
      values.add(range.name === "day of week" && value === 7 ? 0 : value);
    }
  }

  return { values, restricted };
}

export function parseCronExpression(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new ValidationError(
      "Cron expressions need five fields: minute hour day-of-month month day-of-week.",
    );
  }
  const parsed = parts.map((part, index) =>
    parseField(part, FIELD_RANGES[index]),
  );
  return {
    expression: expression.trim(),
    fields: [
      parsed[0].values,
      parsed[1].values,
      parsed[2].values,
      parsed[3].values,
      parsed[4].values,
    ],
    domRestricted: parsed[2].restricted,
    dowRestricted: parsed[4].restricted,
  };
}

export function cronMatches(schedule: CronSchedule, date: Date) {
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = schedule.fields;
  if (!minutes.has(date.getMinutes())) return false;
  if (!hours.has(date.getHours())) return false;
  if (!months.has(date.getMonth() + 1)) return false;

  const domMatch = daysOfMonth.has(date.getDate());
  const dowMatch = daysOfWeek.has(date.getDay());
  if (schedule.domRestricted && schedule.dowRestricted) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

export function isValidCronExpression(expression: string) {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}
