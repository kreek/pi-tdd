# CSV Parser

A library function that parses a CSV string into structured data.

## User Stories

### US-1: Parse CSV with headers into records

**Story**
As a developer
I want a function that parses a CSV string into an array of objects keyed by header names
So that I can work with tabular data from string input

**Acceptance Criteria**
- First row is treated as headers
- Subsequent rows become objects with header keys and string values
- Handles quoted fields: `"hello, world"` is a single value
- Handles escaped quotes within quoted fields: `"say ""hello"""` -> `say "hello"`
- Empty fields produce empty strings
- Trailing newline is ignored
- Returns empty array for input with only a header row
