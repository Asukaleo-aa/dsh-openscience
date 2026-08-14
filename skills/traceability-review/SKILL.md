---
name: traceability-review
description: Use when the user asks to review, verify, or audit a report, manuscript, or analysis in the workspace for traceability — resolving citations, flagging numbers with no source, and checking figures against the code that generated them. Emits a structured review block for downstream consumers. Verifies traceability, never "correctness".
---

# Traceability Review

Audit a workspace document (report, manuscript, or notebook) with three checks.
You verify **traceability** — that claims trace to sources, data, and code —
not truth. Never state or imply that the document is error-free.

## Extracting document text — never guess

Do not read raw bytes or infer a document's contents.

- **PDF** documents: extract the text with `bash` first. Prefer
  `pdftotext MANUSCRIPT.pdf -`, then extract the concrete citation identifiers
  and quantitative claims deterministically, so you audit real identifiers, not
  ones recalled from memory. If `pdftotext` is unavailable, fall back to
  Python: `python -c` with `pdfminer` (or `PyPDF2` if `pdfminer` is missing).
- **Markdown** documents: read them directly with the `read` tool.

If extraction fails with every backend, say so plainly and fall back to
whatever text you can read — do not fabricate identifiers.

## Check 1 · Citation audit

1. Extract every citation identifier from the document: DOI (`10.xxxx/…`),
   arXiv id, PMID, or title + year when no identifier is given.
2. Resolve each against a public registry (no API key needed):
   - DOI: `curl -s "https://api.crossref.org/works/<doi>"`
   - arXiv: `curl -s "http://export.arxiv.org/api/query?id_list=<id>"`
   - PMID: `curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<pmid>&retmode=json"`
3. Findings:
   - `error` — the identifier does not resolve (HTTP 404 / empty result).
   - `warn` — it resolves, but the registry's title/authors/year clearly
     disagree with how the document cites it.
   - `warn` — network unavailable: report "could not verify (offline)" rather
     than skipping silently.

## Check 2 · Untraceable numbers

1. List the document's quantitative claims: statistics, percentages, sample
   sizes, effect sizes, p-values, model scores.
2. For each, look for its source inside the workspace: a data file, a code or
   notebook output, or an execution log that produces that value.
3. Finding: `warn` for any number with no traceable source. Quote the exact
   sentence in the evidence.

## Check 3 · Figure ↔ code consistency

1. For each figure the document references, find the script or notebook in the
   workspace that generates it — match by scanning workspace code for the
   figure's filename.
2. Query the `provenance_last_write` tool for the figure file and for the
   generating script. It returns `{found, path, seq, time}`; `found=false`
   means the file was not written in this session.
3. Findings:
   - `warn` — the generating script's `seq` is greater than the figure's
     `seq`: "figure may be stale — regenerate it from the current code".
   - `warn` — `provenance_last_write` reports `found=false` for a referenced
     figure and no matching file exists in the workspace: "referenced figure
     has no provenance record".

## Output contract

End the reply with exactly one fenced block (downstream consumers, e.g. a fix
agent, parse this block; keep it as the LAST thing in the message):

```review
{"findings":[{"level":"error","check":"citation","title":"DOI does not resolve","evidence":"10.9999/fake.2026 → Crossref 404"}],"note":"Traceability review — verified what could be traced. Absence of findings is not a guarantee of correctness."}
```

- `level`: `error` | `warn` | `ok` · `check`: `citation` | `number` | `figure`.
- One finding per issue; `ok` findings are allowed for confirmed traceable
  items worth stating explicitly.
- Evidence: the exact identifier / quoted sentence / file paths, plus what you
  observed.
- The note must never claim the document has no errors.
