# Slug Generator

A library function that converts a title string into a URL-safe slug.

## User Stories

### US-1: Generate URL slugs from title strings

**Story**
As a developer
I want a function that converts an arbitrary title string into a URL-safe slug
So that I can generate clean, readable URLs from user-provided titles

**Acceptance Criteria**
- Converts to lowercase: "Hello World" -> "hello-world"
- Replaces spaces and underscores with hyphens: "my_cool post" -> "my-cool-post"
- Strips non-alphanumeric characters (except hyphens): "What?! No Way!" -> "what-no-way"
- Collapses consecutive hyphens: "too---many" -> "too-many"
- Trims leading and trailing hyphens: "--hello--" -> "hello"
- Returns empty string for input with no alphanumeric characters
