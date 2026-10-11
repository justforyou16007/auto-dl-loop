---
name: exa-search
description: Search the broad web through Exa with content extraction. Use for blogs, documentation, news, companies, and research-paper web results beyond academic APIs.
argument-hint: [search-query-or-url]
allowed-tools: Bash(*), Read, Write
---

# Exa Search

Query: `$ARGUMENTS`

## Contract

This skill has one implementation: `exa-search.js`. It requires the Exa SDK
and API key through that helper. It does not use WebSearch, another SDK, or an
inline parser when Exa fails.

```bash
EXA_FETCHER=".aris/dist/tools/exa-search.js"
[ -f "$EXA_FETCHER" ] || EXA_FETCHER="dist/tools/exa-search.js"
[ -f "$EXA_FETCHER" ] || {
  echo "ERROR: exa-search.js is required." >&2
  exit 1
}
```

## Workflow

Parse the query or URL and explicit options:

- `--similar` for `find-similar`;
- `--max`, `--category`, `--content`, `--max-chars`;
- `--domains`, `--exclude-domains`, `--start-date`, `--end-date`;
- `--type`, `--include-text`, `--exclude-text`, `--location`.

Run one helper operation:

```bash
node "$EXA_FETCHER" search "QUERY" --max MAX_RESULTS --content highlights || exit 1
node "$EXA_FETCHER" find-similar "URL" --max MAX_RESULTS --content highlights || exit 1
node "$EXA_FETCHER" get-contents "URL1" "URL2" --content text || exit 1
```

An API, SDK, or parsing error fails the skill. Do not rerun the query through
another search source.

## Research Wiki

If `research-wiki/` exists, the wiki helper (`WIKI_SCRIPT=.aris/dist/tools/research-wiki.js`)
is required. Ingest each result the run relies on (paper, repository,
documentation or blog) as a survey. Use the arXiv ID when Exa returns one;
otherwise pass the URL and title exactly as returned, plus authors and year when
present. Missing metadata fails the ingest phase rather than being
reconstructed from a snippet.

```bash
node "$WIKI_SCRIPT" ingest_survey research-wiki/ --arxiv-id "$ARXIV_ID" || exit 1
node "$WIKI_SCRIPT" ingest_survey research-wiki/ --url "$URL" --title "$TITLE" || exit 1
```

Each ingest records the work as `survey:<slug>`. Add `--problems problem:<id>,...`
for the wiki problems the work addresses, and refer to it by that id.

## Output

Show title, URL, date, content mode, and extracted content. Record the exact
Exa query and source URL for every item.
