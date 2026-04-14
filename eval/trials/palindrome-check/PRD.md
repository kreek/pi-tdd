# Palindrome Checker

A library function that checks whether a string is a palindrome.

## User Stories

### US-1: Case-insensitive palindrome check with non-alphanumeric stripping

**Story**
As a developer
I want a function that checks if a string is a palindrome
So that I can validate symmetric text inputs

**Acceptance Criteria**
- Returns true for palindromes like "racecar" and "madam"
- Ignores case: "Racecar" is a palindrome
- Strips non-alphanumeric characters: "A man, a plan, a canal: Panama" is a palindrome
- Returns false for non-palindromes like "hello"
- Empty string and single character are palindromes
