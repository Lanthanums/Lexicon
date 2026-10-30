# Lexicon v2.0 beta2 · Guide and motion refinement

Application version: `2.0.0-beta.2`.

- Replace the lengthy button walkthrough with a single four-module overview and four hidden-interaction exercises: word drag, whole-card drag, long-press reorder and five-dot mastery.
- Run exercises in the real management UI using a temporary in-memory library. No personal library imports, snapshots or learning writes are performed. Skip and Escape remain available; Settings can replay the guide.
- Fix the transient centered hint between steps by preparing target geometry and panel position before reveal, with a deliberate fade between stable states.
- Keep centering/anchor transforms intact throughout dialog, confirmation and popover motion. Remove nested page/card entry motion and permanent button compositing hints.
- Make mastery slider tracks follow the thumb immediately; honor reduced motion in every review-forecast line.
- Preserve the clean Lexicon logo and the existing beta2 learning, management and backup behavior.
- Fall back to copying the staged snapshot when a Windows file system rejects rename with EXDEV; retain the staged recovery file if that copy fails.

MIT application license. Bundled lexical data retains its own attribution and license. Personal libraries, credentials, learning records and local engineering reports are not included in the source distribution.
