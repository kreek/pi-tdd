# Notes App (Monorepo)

A monorepo with two packages: an API server and a shared validation library.

## Structure

```
api/          -- Express REST API (has its own package.json and tests)
shared/       -- Validation utility library (has its own package.json and tests)
```

## User Stories

### US-1: Note validation (shared/)

**Story**
As a notes-app developer
I want a shared note-validation library
So that validation rules stay consistent across the project

**Acceptance Criteria**
- Validate note title: required, 1-100 characters
- Validate note body: required, 1-10000 characters
- Sanitize input: trim whitespace, strip HTML tags
- Return structured validation errors with field name and message

**Additional Notes**
- Implement this story in `shared/`

### US-2: CRUD notes (api/)

**Story**
As an API consumer
I want to create and list notes
So that the notes API supports basic CRUD behavior

**Acceptance Criteria**
- `POST /api/notes` creates a note from `title` and `body`, validates with the shared library, and returns 201 or 422
- `GET /api/notes` lists all notes and returns 200 with a JSON array
- Use in-memory storage (no database)

**Additional Notes**
- Implement this story in `api/`
- The API must use the validation logic from `shared/`

### US-3: Filter by tag (api/)

**Story**
As an API consumer
I want to filter notes by tag
So that I can find relevant notes quickly

**Acceptance Criteria**
- Notes can have an optional tags array
- `GET /api/notes?tag=foo` filters notes by tag
- Tags must be non-empty strings, validated via the shared library

**Additional Notes**
- Implement this story in `api/`
