# Question Handling Improvement

## Summary

Modified the agent's question handling to allow questions without specific filters while maintaining security through grounded answers.

## Problem

The previous implementation blocked ALL questions that didn't have a filter, returning "I need to know what you're asking about." This prevented legitimate questions like:
- "What did I do today?"
- "Show me everything"
- "What happened this week?"
- Conceptual questions like "What is the difference between farm and field?"

## Solution

### 1. Added "help" Intent

Added a new intent type `"help"` to distinguish:
- **Question intent**: Queries about farm records (still answered from database)
- **Help intent**: Conceptual/general farming questions (redirects to experts)

### 2. Removed Filter Requirement for Questions

Questions without filters now default to querying records without restrictions, allowing the database and answer logic to determine what to show.

### 3. Improved Report Handling

Reports without filters now default to a summary report type instead of blocking.

## Security Model Maintained

The changes preserve the existing security architecture:

1. **Structured Extraction**: Zod validation prevents prompt injection at intent classification
2. **Intent-Based Routing**: Enum-constrained intents limit what the model can do
3. **Grounded Answers**: All answers in `farm-question.ts` still:
   - Only use actual records from database
   - Must cite record IDs used
   - Reject answers without citations (unless limitation answers)
   - Cannot hallucinate information

## Changes Made

### `src/domain/farm-event.ts`
- Updated `agentIntentSchema` to include `"help"` intent

### `src/application/extract-farm-event.ts`
- Added `"help"` to intent enum in extraction instructions
- Clarified that questions can have null filters (will query recent records)
- Added examples of conceptual questions that should be classified as "help"

### `src/application/farm-agent.ts`
- **Question handling**: Removed filter requirement, default to empty filter object
- **Report handling**: Removed filter requirement, default to summary report
- **Help handling**: Added new case returning redirect message to agricultural experts

## Testing

All existing tests pass:
- ✓ `tests/extraction-modes.test.ts` (17/17 tests)
- ✓ `tests/farm-agent.test.ts` (48/48 tests)
- ✓ No TypeScript errors

## User Impact

Users can now:
- Ask broad questions: "What did I do today?" → Tilly queries today's records
- Request everything: "Show me everything" → Tilly queries all recent records
- Get help on concepts: "What is farm vs field?" → Tilly explains her limitations and suggests experts
- Implicit filters still work: "When did I last weed?" → Tilly queries weeding records

## Example Conversation (Fixed)

**Before:**
```
User: what is the difference between farm and field
Tilly: I need to know what you're asking about.
```

**After (help intent):**
```
User: what is the difference between farm and field
Tilly: I keep track of your farm activities and can answer questions about what you've recorded. For general farming advice, I recommend consulting with local agricultural experts or extension services.
```

**Before:**
```
User: what did I do today
Tilly: I need to know what you're asking about.
```

**After (question with implicit filter):**
```
User: what did I do today
Tilly: [Queries records from today and provides grounded answer]
```

## Design Philosophy

The trust model remains unchanged:
- **Model proposes, code validates**: The model suggests intents and extracts data, but deterministic code validates everything
- **Grounded answers only**: Answers come from actual farm records, not AI knowledge
- **No hallucination**: The citation requirement prevents invented information
- **Security by structure**: Zod schemas and enum constraints prevent prompt injection

## Future Improvements

Potential enhancements (not implemented):
1. Default date filters for questions (e.g., "what did I do" → last 7 days)
2. More sophisticated help responses for specific farming topics
3. Suggest related records when conceptual questions are asked
4. Smarter filter inference from natural language
