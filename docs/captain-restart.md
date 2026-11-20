# Captain Restart discovery (#33)

Dex, 2026-11-19. Scope: [issue #33](https://github.com/halex5000/elephants-on-mars/issues/33).

## Finding: behavior remains unknown

The issue reports that the original Captain screen shows a Restart button, but the available footage does not show its behavior. The existing README (Rules and fidelity), PRODUCT speculative list, and N5 backlog entry likewise provide no confirmed behavior or availability conditions. This review adds no new footage evidence.

Alex was asked during this session: “In the original Elephants on Mars, what did the Captain’s Restart button do, and when was it available?” No answer has been received at the time of this record. This is an unresolved factual question, not confirmation that the original lacked the feature.

No Restart behavior is implemented or inferred. In particular, the existing money-reclaim controls are documented additions and do not establish what Restart did.

## If evidence becomes available

Record the original player's answer in #33, including when the button was available, what changed on activation, and what remained intact. Confirm whether Alex still wants that behavior before opening an implementation issue.

The smallest follow-up would implement only the confirmed Captain action and its availability, with server authorization and focused engine and browser tests for the confirmed effects. Exact state changes and affected files must be scoped from that answer; no reset, refund, retry, or timing semantics are assumed here. Alex prioritizes that separate issue.
