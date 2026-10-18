# Scale event outbox — durable contract and security boundaries

This is the **application-layer outbox** for `POST /api/device/scale-events`, not yet connected to the XIAO's Wi-Fi or pairing UI. It uses existing `IFileQueue` (LittleFS), `IStorage` (NVS), and `IRandom` (UUIDs), and is tested with fake ports.

## Persistence and idempotency

1. After a successful device pairing, call `activatePairing(freshPairingEpochUuid)`. The UUID **must change whenever a new device token is issued**. It is not the permanent device ID.
2. The outbox stores `scale_epoch` and `scale_seq` in NVS. Before each JSONL append it reserves the next sequence in NVS. Power loss may create gaps but must not reuse a sequence in the same pairing epoch.
3. Queue file `/scale-<epoch-uuid>.jsonl` is specific to that pairing epoch. Re-pairing changes the filename; **old queued events are quarantined** and must never be uploaded with the new token, especially if the device changed houses.
4. Queue cap: 512 pending events. Overflow refuses new events rather than silently deleting old measurements. Batch cap: 50 events.
5. **Never enqueue raw ADC samples at the HX711 sampling rate**: this would exhaust the 512-event queue and cause unnecessary NVS flash wear. Enqueue only sparse, meaningful stable-weight/bowl/fault transitions after a separate event-rate policy has been bench-validated. Event UUIDs come from the device CSPRNG; `observedAt` requires a synchronized UTC epoch timestamp. Unsynchronized timestamps are refused (they must be buffered by a future clock-recovery layer rather than uploaded with a guessed time).
6. The outbox emits the exact strict JSON contract: `id`, `sequence`, `observedAt`, `calibrationRevision`, `kind`, plus `grossMg` or `code` as appropriate. No `houseId` or `deviceId` is accepted from the firmware body.

## Acknowledgment rule

- HTTP **201** and a valid JSON body with `accepted: string[]` and `now` mean the server persisted **every** submitted event or recognized it as an identical replay. Thus `accepted: []` can still acknowledge the whole batch.
- The outbox validates that returned accepted IDs are a subset of the exact head batch, then atomically rewrites the queue **before** updating memory.
- All other statuses, including 200, 400, 401, 409, 429, 5xx, malformed JSON and network failures, retain the queue. A 401 requires re-pairing; a 409 needs operator conflict investigation.
- If LittleFS rewrite fails, nothing is dropped; a later 201 can safely replay the same UUIDs.

## Failure handling / remaining work

- A malformed queue entry causes activation to fail closed; it is **not silently skipped**. Operator recovery and damaged-file export must be added before unattended deployment.
- A failed append or NVS sequence reservation disables the outbox until it is reloaded. A partially written final JSONL line needs explicit recovery; do not blindly append again.
- Old-epoch files remain on flash intentionally for investigation. Implement secure retention/cleanup with explicit policy; do not reassign events across houses.
- The outbox is **not yet wired into the XIAO bench firmware**, and there is no Wi-Fi uploader, retry scheduler, TLS/pairing provisioning, or cloud event source. Tests prove persistence and response handling using fake storage, not power-cut resilience on real flash.
- Hardware safety remains independent: overload stops must be installed and physically calibrated before pet use.
