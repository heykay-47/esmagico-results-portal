# Student Results Portal

An administrator uploads a CSV of term results. The portal imports the valid rows and lists every problem in the other rows in plain language. The administrator can then search the students and open a report for each one.

Design decisions and trade-offs are in [NOTES.md](NOTES.md).

## Run it with Docker

You need Docker. Build the image and start a container:

```bash
docker build -t results-portal .
docker run --rm -p 8080:8080 -v results-portal-data:/data results-portal
```

Open <http://localhost:8080> and go to **Import**. The database lives in the `results-portal-data` volume, so students survive a restart. Drop the `-v` flag for a throwaway database.

To fill the running app with 5,000 generated students, run the seed script inside the container:

```bash
docker exec $(docker ps -q --filter ancestor=results-portal) node scripts/seed.ts --out /data/seed.csv --load
```

## Run it locally

You need Node.js 24 or later. Node runs the TypeScript files directly, so there is no build step.

```bash
npm install
npm start            # http://localhost:8080
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATABASE_PATH` | `data/portal.db` | SQLite file. Its folder is created if missing. |

## Run the tests

```bash
npm test             # all tests, about 1 second
npm run typecheck    # tsc --noEmit
```

To run the tests without Node installed, use `docker build --target test .`.

The tests cover the CSV reader, every column rule and its boundaries, file-level failures, and duplicates. They also cover the HTTP API end to end and the grading scheme. A property test generates 20 random messy files and checks that the importer rejects exactly the rows the generator broke on purpose.

If you copy `students_small.csv` and `students_sample.csv` from the sample pack into the repo root, two more tests check the counts the pack's README expects. They are 16 imported and 9 rejected for the small file, and 4,685 and 315 for the large one. The sample files are confidential, so `.gitignore` keeps them out of the repo, and the tests skip when the files are missing.

## Generate messy data

```bash
npm run seed                                  # 5,000 rows to data/seed.csv
npm run seed -- --rows 20000 --error-rate 0.1 # bigger and dirtier
npm run seed -- --load                        # also import into DATABASE_PATH
```

The generator writes the kind of mess the sample pack has. That includes a byte order mark, CRLF line endings, quoted `"Last, First"` names, accented names, padding, mixed case, and both date formats. It also writes blank lines, an extra column, duplicates, and nine kinds of broken row. It counts the rows it broke, runs the importer over its own output, and exits with an error if the counts disagree.

## API

The browser is the only client, but the API is plain JSON.

| Method and path | Purpose |
|---|---|
| `POST /api/imports` | Import a CSV sent as the raw request body. The optional `X-File-Name` header holds the URI-encoded file name. Returns `201` with the summary and up to 1,000 problems, `422` for a file that cannot be read as a results CSV, and `413` above 10 MB. |
| `GET /api/imports` | The 10 most recent imports |
| `GET /api/imports/:id` | One import summary with its problems |
| `GET /api/imports/:id/problems.csv` | Every problem as a CSV download |
| `GET /api/students?q=&class=&section=&sort=id\|name\|class\|percentage&dir=asc\|desc&page=1&pageSize=25` | Search and page through students |
| `GET /api/students/:id` | One student with total, percentage, grade, and pass or fail. Returns `404` if the ID is unknown. |
| `GET /api/grading` | The grading bands and pass mark |

## Project layout

```text
src/csv.ts        CSV reader that keeps line numbers and detects unclosed quotes
src/rules.ts      Column rules: one raw row to a typed student or a list of problems
src/analyse.ts    Whole file to accepted rows and problems. Pure, no I/O.
src/grading.ts    Total, percentage, grade, and pass or fail
src/db.ts         SQLite schema, upsert import, search
src/server.ts     Express routes and error handling
public/           Browser app: plain ES modules and Tabler, no build step
scripts/          Messy-data generator and seed command
test/             node:test suites
```
