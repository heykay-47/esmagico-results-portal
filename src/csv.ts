// Minimal RFC 4180 CSV reader that keeps the line number each record starts on.
// We need exact line numbers for the error report (header = line 1, blank lines
// counted), and we need to know about an unclosed quote instead of silently
// swallowing the rest of the file, so a small hand-written reader is simpler
// than bending a library to do both.

export type CsvRecord = { line: number; fields: string[] };

export type CsvParseResult = {
  records: CsvRecord[];
  /** Line where a quoted field was opened but never closed, if any. */
  unclosedQuoteLine: number | null;
};

export function parseCsv(text: string): CsvParseResult {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = "";
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field.trim() === "") {
      // Opening quote; whitespace before it is dropped, like spreadsheet apps do.
      inQuotes = true;
      quoteStartLine = line;
      field = "";
      i++;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
      i++;
    }
  }

  if (inQuotes) {
    // Keep what we have so the caller can report it; the record is incomplete.
    endRecord();
    return { records, unclosedQuoteLine: quoteStartLine };
  }
  // A final line without a trailing newline is still a record.
  if (field !== "" || fields.length > 0) endRecord();
  return { records, unclosedQuoteLine: null };
}
