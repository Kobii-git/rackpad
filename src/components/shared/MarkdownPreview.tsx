import type { ReactNode } from "react";

export function MarkdownPreview({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) {
    return (
      <div className="text-sm text-[var(--color-fg-subtle)]">
        Nothing documented yet.
      </div>
    );
  }
  return (
    <div className="space-y-3" data-no-i18n>
      {blocks}
    </div>
  );
}

function parseBlocks(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !lines[index].trimStart().startsWith("```")
      ) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={`code-${index}`}
          className="overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-fg)]"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className =
        level === 1
          ? "text-xl font-semibold tracking-tight"
          : level === 2
            ? "text-lg font-semibold tracking-tight"
            : "text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]";
      blocks.push(renderHeading(level, heading[2], className, index));
      index += 1;
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      blocks.push(renderTable(table, index));
      index = table.nextIndex;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-2 border-[var(--color-accent)] pl-3 text-sm text-[var(--color-fg-subtle)]"
        >
          {quoteLines.map((quote, lineIndex) => (
            <p key={lineIndex}>{renderInline(quote)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul
          key={`ul-${index}`}
          className="list-disc space-y-1 pl-5 text-sm text-[var(--color-fg)]"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol
          key={`ol-${index}`}
          className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-fg)]"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trimStart().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !parseTable(lines, index) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p
        key={`p-${index}`}
        className="text-sm leading-6 text-[var(--color-fg)]"
      >
        {renderInline(paragraphLines.join(" "))}
      </p>,
    );
  }

  return blocks;
}

type MarkdownTable = {
  headers: string[];
  rows: string[][];
  nextIndex: number;
};

function parseTable(lines: string[], index: number): MarkdownTable | null {
  if (index + 1 >= lines.length) return null;
  if (!isTableSeparator(lines[index + 1])) return null;

  const headers = splitTableRow(lines[index]);
  if (headers.length < 2) return null;

  const rows: string[][] = [];
  let nextIndex = index + 2;
  while (nextIndex < lines.length && isTableRow(lines[nextIndex])) {
    rows.push(
      normalizeTableRow(splitTableRow(lines[nextIndex]), headers.length),
    );
    nextIndex += 1;
  }

  return { headers, rows, nextIndex };
}

function isTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed !== "" && !trimmed.startsWith("```");
}

function isTableSeparator(line: string) {
  const cells = splitTableRow(line);
  return (
    cells.length > 1 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
  );
}

function splitTableRow(line: string) {
  const trimmed = line.trim();
  const withoutLeading = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailing = withoutLeading.endsWith("|")
    ? withoutLeading.slice(0, -1)
    : withoutLeading;
  return withoutTrailing.split("|").map((cell) => cell.trim());
}

function normalizeTableRow(cells: string[], size: number) {
  if (cells.length === size) return cells;
  if (cells.length > size) return cells.slice(0, size);
  return [...cells, ...Array.from({ length: size - cells.length }, () => "")];
}

function renderTable(table: MarkdownTable, index: number) {
  return (
    <div
      key={`table-${index}`}
      className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]"
    >
      <table className="min-w-full border-collapse text-left text-sm text-[var(--color-fg)]">
        <thead className="bg-[var(--color-bg)]">
          <tr>
            {table.headers.map((header, headerIndex) => (
              <th
                key={headerIndex}
                className="border-b border-[var(--color-line)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]"
              >
                {renderInline(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-t border-[var(--color-line)] first:border-t-0"
            >
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderHeading(
  level: number,
  text: string,
  className: string,
  index: number,
) {
  const children = renderInline(text);
  if (level === 1) {
    return (
      <h2 key={`heading-${index}`} className={className}>
        {children}
      </h2>
    );
  }
  if (level === 2) {
    return (
      <h3 key={`heading-${index}`} className={className}>
        {children}
      </h3>
    );
  }
  return (
    <h4 key={`heading-${index}`} className={className}>
      {children}
    </h4>
  );
}

function renderInline(text: string) {
  const parts: ReactNode[] = [];
  const pattern =
    /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) != null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined && match[3]) {
      parts.push(
        <img
          key={`img-${match.index}`}
          src={match[3]}
          alt={match[2]}
          className="my-3 max-h-[520px] max-w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] object-contain"
          loading="lazy"
        />,
      );
    } else if (match[4] !== undefined && match[5]) {
      parts.push(
        <a
          key={`a-${match.index}`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {match[4]}
        </a>,
      );
    } else if (match[6] !== undefined) {
      parts.push(
        <code
          key={`code-${match.index}`}
          className="rounded-[var(--radius-xs)] bg-[var(--color-bg)] px-1 py-0.5 font-mono text-[0.92em]"
        >
          {match[6]}
        </code>,
      );
    } else if (match[7] !== undefined) {
      parts.push(
        <strong key={`strong-${match.index}`} className="font-semibold">
          {match[7]}
        </strong>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
