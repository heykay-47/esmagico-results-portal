import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.ts";

const fieldsOf = (text: string) => parseCsv(text).records.map((r) => r.fields);
const linesOf = (text: string) => parseCsv(text).records.map((r) => r.line);

test("quoted fields may contain commas and escaped quotes", () => {
  assert.deepEqual(fieldsOf('a,"Singh, Aarav","say ""hi"""\n'), [["a", "Singh, Aarav", 'say "hi"']]);
});

test("Windows, Unix and old-Mac line endings all split records", () => {
  assert.deepEqual(fieldsOf("a,b\r\nc,d\ne,f\rg,h"), [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
});

test("record line numbers count blank lines", () => {
  assert.deepEqual(linesOf("h\r\nx\r\n\r\ny\r\n"), [1, 2, 3, 4]);
});

test("a newline inside quotes stays in the field and later lines are still numbered right", () => {
  const { records } = parseCsv('h\n"two\r\nlines",x\nnext\n');
  assert.equal(records[1].fields[0], "two\r\nlines");
  assert.equal(records[2].line, 4);
});

test("last line without a trailing newline is kept; empty trailing field is kept", () => {
  assert.deepEqual(fieldsOf("a,b\nc,"), [["a", "b"], ["c", ""]]);
});

test("an unclosed quote is reported with the line it opened on", () => {
  const result = parseCsv('h\nok\n"never closed,x\nmore\n');
  assert.equal(result.unclosedQuoteLine, 3);
});
