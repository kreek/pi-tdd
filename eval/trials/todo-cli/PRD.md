# Todo CLI

A command-line todo manager that persists items to a JSON file.

## User Stories

### US-1: Add and list

**Story**
As a CLI user
I want to add todos and list what I have
So that I can track work from the command line

**Acceptance Criteria**
- Add a todo with a text description; it gets a unique numeric ID
- List all todos showing ID, description, and status (active or completed)
- New todos default to active status

**Additional Notes**
- IDs should be stable enough to support later commands like complete and delete

### US-2: Complete and delete

**Story**
As a CLI user
I want to complete or delete todos by ID
So that I can keep my list current

**Acceptance Criteria**
- Mark a todo as completed by ID
- Delete a todo by ID
- Return an error for unknown IDs

**Additional Notes**
- Error handling should not corrupt persisted data

### US-3: Filter and persist

**Story**
As a CLI user
I want filtering and persistence
So that my todo list survives across sessions and is easier to inspect

**Acceptance Criteria**
- Filter todos by `all`, `active`, or `completed`
- Persist todos to a JSON file on every mutation
- Load from the JSON file on startup and create it if missing

**Additional Notes**
- Persistence format should be JSON
