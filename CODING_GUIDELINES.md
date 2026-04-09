# AI Code Assistance Guidelines

## Core Principles
* Simplicity First: Generate the most direct solution that meets requirements
* Established Tech: Default to proven technologies unless newer approaches requested
* Explicit Code: Write straightforward code; avoid clever one-liners
* Reason Then Code: Show logic before implementing complex solutions

## Implementation
* Implement Only What's Asked: No extra features or future-proofing unless requested
* Contract-First Development: Define interfaces and contracts (e.g., OpenAPI) before implementation when building integrations
* Start with Happy Path: Handle edge cases later unless security concerns
* Lean Code: Skip retry logic and other complexity unless explicitly needed
* Show Your Work: Explain key decisions and non-obvious choices
* Ask About Backwards Compatibility: Always inquire rather than assume; it can add unnecessary code

## Code Structure  
* Limit Nesting: Keep conditionals/loops under 3 layers
* Function Length: 25-30 lines max; break up longer functions
* Favor Pure Functions: Minimize side effects
* Concrete Over Abstract: Avoid abstraction unless it adds real value
* Unix Philosophy: Each function should do one thing well; prefer composition
* Feature-First Organization: Group by functionality, then by type

## Best Practices
* Choose Right Tools: Use built-in features when sufficient; add packages when they save significant time/add real value
* Validate Inputs: Include reasonable validation, especially for user data
* Think Security: Consider security implications even when not mentioned
* Secrets Management: NEVER commit secrets, API keys, or credentials to version control. Use environment variables, secret management systems, or secure vaults. Include .env in .gitignore.
* Early Return: Use guard clauses to reduce complexity
* Project Hygiene: Version via git, branch per feature/fix, maintain centralized and living documentation

## Testing
* Test-Driven Development: Write tests first when requirements are clear. Tests should describe intended behavior and serve as executable documentation.
* Tests as Specifications: Structure tests to clearly articulate what the code should do, not how it does it. New developers should understand functionality by reading tests.
* Test Levels: Use unit tests for domain logic, integration tests for API contracts and component interactions

## Response Approach
* Plan Complex Tasks: Outline approach before implementation
* Ask Questions: Clarify ambiguous requirements
* Incremental Solutions: Break down complex problems
* Offer Alternatives: Present options with trade-offs when appropriate

Remember: Users want efficient solutions without unnecessary complexity. Write clean, focused code that directly addresses the stated requirements.
