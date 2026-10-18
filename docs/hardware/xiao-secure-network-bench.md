# XIAO ESP32S3 Sense: secure scale network bench (firmware 0.1.39)

This is a **USB-supervised laboratory firmware**. It connects an operator-approved stable gross-weight measurement to the existing scale event API through a persistent, pairing-isolated outbox. It does **not** infer food consumed, automatically tare a bowl, use the camera, or authorize unattended operation with pets.

## What changed

- `xiao-scale-bench`: unchanged offline calibration bench.
- `xiao-scale-net`: same HX711 calibration and stability logic, plus Wi-Fi, NTP, CA-validated HTTPS, public pairing-code flow, private token, durable queue and authenticated upload.
- Hardware model `xiao-esp32s3-sense-scale` is accepted by the shared/backend pairing schema.
- A pairing token and a fresh local epoch UUID are stored in **one** NVS blob. After a reboot the same epoch and JSONL queue are restored; after unpair/re-pair, the old queue remains quarantined.
- The XIAO network adapter uses `WiFiClientSecure::setCACert` with public GTS Root R1 and ISRG Root X1 anchors, checks the TLS hostname, rejects HTTP and redirects, and refuses HTTPS until the NTP clock is valid. **No `setInsecure()`.** If Cloudflare's chain changes to an untrusted root, the device fails closed until the CA bundle is updated.
- Scale LittleFS is mounted with `formatOnFail=false`. A corrupt filesystem is **never silently erased** to allow uploads.

## Build and flash

```bash
cd firmware
pio test -e native
pio run -e xiao-scale-bench
pio run -e xiao-scale-net
pio run -e xiao-scale-net -t upload
pio device monitor -b 115200
```

Wiring is identical to [the HX711 bench](../hardware/xiao-hx711-bench.md): 3V3/GND, D0/GPIO1 = DOUT, D1/GPIO2 = SCK.

**Partition warning:** `xiao-scale-net` uses `partitions/xiao_8mb.csv`, different from an unpartitioned earlier bench. Flashing a new partition table can invalidate existing flash data. Export any needed calibration, and recalibrate after migration. Flashing this target must not be treated as a no-data-loss OTA update.

## USB commands

1. Start `netstatus` to display the derived 32-hex-character device ID, Wi-Fi, NTP and pairing state. The token is never printed.
2. On a **factory-new blank flash only**, use `initfs ERASE` to explicitly format the LittleFS partition. **Destructive:** never do this to recover a corrupted filesystem with pending measurements without first exporting it.
3. `wifi YourSSID|YourWpaPassword` stores Wi-Fi credentials locally in NVS, joins the access point and starts SNTP. This is **USB-only provisioning**, not a production onboarding flow. The serial terminal may echo what you type, and NVS is not encrypted by this firmware; use a trusted local bench and a test Wi-Fi network.
4. Wait for `netstatus` to show `wifi=1 clock=1`. Type `pair`; a six-digit code is shown. In the FeedMe2 web app, confirm that code while signed into the intended house. The XIAO polls `/api/pair/check` with a device-generated 128-bit secret. The signed device token is stored locally but never shown on serial.
5. Perform explicit `zero`, `ref <known_mass_mg>`, `limit <validated_max_gross_mg>`, `commit`, `tune <min_samples> <dwell_ms> <spread_mg> <max_gap_ms>`, `run` as in the original bench. Calibration parameters require real measurements; do not copy demonstration thresholds into production.
6. Once a stable gross mass appears, type `record`. This adds **one** `stable_weight` observation with a synchronized UTC timestamp, a calibration revision and a UUID to LittleFS. It requires a fresh stable sample, an authenticated pairing, and a minimum **60-second interval** since the previous manual record. There is **no automatic recording**.
7. Type `sync` to POST queued events to `/api/device/scale-events` with certificate validation and Bearer authentication. While online, the service also retries pending events at most once per minute. Only a valid HTTP **201** acknowledges and removes a batch. `netstatus` shows pending count and last HTTP status, not credentials.
8. `unpair` deletes the active credential; previous-epoch queued observations remain on flash but are **not** uploaded under the next house/token. `forgetwifi` clears local Wi-Fi credentials.

## Safety and limitations

- **Do not use this with pets.** The 1 kg load cell still lacks calibrated physical overload stops and a validated complete load path.
- NVS token/Wi-Fi credential storage is not hardware-encrypted or protected against physical flash extraction. Production provisioning must enable ESP32 flash encryption, secure boot and an approved recovery process.
- A captive portal or malicious AP cannot read Bearer tokens because the client validates TLS certificates and hostnames. No TLS redirect following is enabled.
- Sensor faults and lost calibration are never converted into successful weight events. No automatic food-addition inference is made.
- The cloud API stores stable gross mass only, **not an amount eaten**.
- Network operations can block the serial loop for up to the 8-second timeout. Asynchronous networking, clock recovery while offline, event-rate policy, and battery/OTA design remain follow-ups.
- Outbox recovery on partial flash writes is fail-closed. A physical power-cut test, queue export/repair workflow, and wear/endurance validation are still required.
- The existing CrowPanel `WifiNetwork` still uses `setInsecure()` and is **not fixed by this PR**; this is intentionally isolated to the new XIAO target.
