# Security Specification for Legal Risk Management App

## Data Invariants
1. A user can only access their own profile.
2. A Risk, Task, Regulation, or ActivityLog must belong to a valid `userId`.
3. Users can only read/write documents where `userId` matches their `auth.uid`.
4. `createdAt` and `updatedAt` must be server-validated.
5. Critical fields like `role` or `healthScore` should be protected from unauthorized manipulation (though in this demo app, the user mostly controls their own state, we should still ensure they can't mess with others).

## The Dirty Dozen Payloads

1. **Identity Spoofing (Create)**: Attempt to create a Risk with `userId` of another user.
2. **Identity Spoofing (Update)**: Attempt to change the `userId` of an existing Risk.
3. **Cross-User Read**: Attempt to get a Regulation document belonging to another user.
4. **PII Leak**: Attempt to list all users to find emails/names.
5. **Timestamp Forge**: Attempt to set `createdAt` to a past date.
6. **Shadow Update**: Attempt to inject `isAdmin: true` into a User document.
7. **Orphaned Write**: Attempt to create a Task with a non-existent `userId`.
8. **Resource Poisoning**: Attempt to use a 2MB string for `riskId`.
9. **State Shortcut**: Attempt to resolve a Risk without providing an action plan (if validation was strict).
10. **Unauthorized Delete**: Attempt to delete another user's Task.
11. **Malicious ID**: Attempt to create a document with ID `../../etc/passwd`.
12. **Blind List**: Attempt to list all ActivityLogs without filtering by `userId`.

## Test Runner (Draft)
```typescript
// firestore.rules.test.ts (conceptual)
// 1. Authenticate as User A
// 2. Attempt to write to /users/UserB (DENY)
// 3. Attempt to write Risk with userId: UserB (DENY)
// 4. Attempt to write Risk with userId: UserA (ALLOW)
// 5. Attempt to read /regulations/RegOwnedByB (DENY)
```
