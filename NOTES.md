# Notes

## Stack

The backend is Node 24 running TypeScript directly through type stripping, with Express 5 and SQLite through the built-in `node:sqlite`. The frontend is plain ES modules with Tabler, served by the same process. That is one process and two runtime dependencies, with no build step and no native modules. SQLite fits one school's data. With about 97,000 students, a search with a sort answers in 17 ms. A frontend framework would add a build pipeline for three screens. All text in the views goes through one escaping template tag.

## What counts as a valid row

I followed the sample pack's rules and checked them against its expected counts. Both files match (16 and 9, then 4,685 and 315), and the 348 problems match the brief's sketch. The rules are one table of columns in `src/rules.ts`. The traps I found:

- Marks use a strict decimal pattern, not `Number()`. `Number("")` is 0 and `Number("1e3")` is 1000, so `N/A`, `eighty`, `82/100`, `1e3`, `0x10`, and a blank cell are all rejected.
- Dates must be real dates (`31/02/2012` is rejected). `11-30-2010` and `14.03.2011` are rejected rather than guessed, because a guess could swap day and month silently.
- Age is in completed years on the day of the import. Results therefore depend on the date, and the tests pin "today".
- Names accept any Unicode letters, apostrophes, commas, hyphens, and full stops. `Søren`, `Zoë D'Souza`, and `"Patel, Sahil"` are valid. Digits are not.
- A row of only commas is skipped even when its field count is wrong. A whitespace-only line is skipped too.
- Each row reports every problem, not only the first, so one round of fixes is enough. Messages name the column and the value. The error code is a badge and a column in the CSV download.

## Duplicates and re-uploads

Inside one file, the first row with an ID is the original, even if that row is itself invalid. Later rows with that ID are rejected, and the message points to the original line. A row with the wrong number of fields does not claim its ID, because its columns cannot be trusted.

Across files, the student ID is the key. A later upload updates the student, so a teacher can upload a corrected file. Re-uploading the same file changes nothing and reports "N unchanged". The import also notes that this exact file (matched by SHA-256) was imported before. A student missing from a later file is not deleted, because files may cover one class each.

## Bad, large, and slow files

File-level failures return one clear message, and nothing changes. These failures are an empty file, a renamed `.xlsx`, non-UTF-8 text, binary data, missing or repeated required columns, and a file with no header row. An unclosed quote rejects the row it swallowed and says so. Each import runs in one transaction. Uploads are capped at 10 MB, which is about 100,000 rows, and the browser checks the size and extension before sending. Measured here, 5,000 rows import in 0.09 s and 100,000 rows in 1.4 s, so the import runs inside the request with an upload progress bar, not as a background job.

## Grading

Percentage is the total out of 500, to one decimal place. The grades are A at 80% and above, B at 60%, C at 50%, D at 33%, and F below 33%. The grade uses the rounded figure, so it always agrees with the number on screen. A pass needs at least 33 in every subject, the common Indian board rule. A student can therefore have a C and still fail. The report says which subjects were below the pass mark.

## Order of work, and what I left out

I built the rules and tests against the sample counts first, then the import API, the screens, and finally the seed script and Docker. I left out authentication, deleting or rolling back an import, editing a student in the UI, and an "absent" mark (`AB`). Absent marks are rejected for now.

## Next

- Ask the school whether `AB` or `N/A` should mean "absent" and count as 0, rather than reject the row.
- Add login, because the portal shows personal data.
- Move imports to a background job with progress polling if files grow past about 100,000 rows.
- Add browser tests with Playwright for the three screens. I checked them by hand in a headless browser.
