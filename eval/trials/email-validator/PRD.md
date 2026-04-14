# Email Validator

A library function that validates email address format.

## User Stories

### US-1: Validate email address format

**Story**
As a developer
I want a function that validates whether a string is a well-formed email address
So that I can reject malformed input at the boundary

**Acceptance Criteria**
- Accepts standard emails: "user@example.com", "first.last@domain.org"
- Accepts emails with subdomains: "user@mail.example.com"
- Accepts plus-addressing: "user+tag@example.com"
- Rejects missing @ sign: "userexample.com"
- Rejects missing local part: "@example.com"
- Rejects missing domain: "user@"
- Rejects spaces: "user @example.com"
- Rejects double dots in domain: "user@example..com"
