## Spec review confirmation

**Original P1 resolved. No remaining Spec findings.**

Reviewed product fix `c7a7789a2c096686e9a6fec87de6f1e83b265432`, independently exercised at `0b481870468ccb667d158c7e53db06b376ef329f` (the additional changes are evidence/documentation only).

The shared guard enumerates conditional-include definitions under the source configuration and refuses checkout-dependent `includeIf.onbranch` whether currently active or inactive. It runs both at fresh planning entry and before copying simulator configuration. This is the specification's permitted conservative refusal for unsupported replay semantics; existing saved operations do not gain this new initial requirement. Stable directory-based includes remain supported.

Independent checks:

- Reran the original public-process reproduction unchanged apart from the candidate path. Both preview and application now refuse with the explicit conditional-configuration message, without READY, PUT, PR edit, a new landing record or cache lock. The former partial merge no longer occurs. Retained `review-conditional-config-fixed.cjs` / `.json` alongside the original red evidence.
- Reran all three new public conditional-configuration regressions on Node: **3 passing**, including active union, inactive future command protection, and the stable gitdir positive control.

No source edits, live GitHub changes, user-project changes, full matrix or installation changes performed by this review.
