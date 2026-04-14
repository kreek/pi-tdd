# Word Frequency Counter

A library that counts word frequencies in text.

## User Stories

### US-1: Basic counting

**Story**
As a developer
I want to count words in a string
So that I can analyze text frequency data

**Acceptance Criteria**
- Count word frequencies in a string
- Return a map or dictionary of word to count
- Split on whitespace and punctuation

**Additional Notes**
- Tokenization should treat punctuation as separators

### US-2: Options

**Story**
As a developer
I want configurable counting options
So that the word-frequency results are more useful

**Acceptance Criteria**
- Case-insensitive mode is on by default, so `"The"` and `"the"` count as one
- Support a configurable stop-word list for words to exclude from results
- Default stop words are `a`, `an`, `the`, `is`, `at`, `of`, `in`, `on`, and `to`

**Additional Notes**
- Case-insensitive mode should be configurable rather than hardcoded

### US-3: Top-N results

**Story**
As a developer
I want the top N word-frequency results
So that I can focus on the most relevant tokens

**Acceptance Criteria**
- Return top N words sorted by frequency in descending order
- Break ties alphabetically in ascending order
- `N` defaults to 10 and should return all results if fewer than `N` unique words exist

**Additional Notes**
- Sorting rules must be deterministic for ties
