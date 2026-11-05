# Phase 3.2.2–3.2.3 independent review

Target: `main`. Feature branch: `feature/phase-3.2.3-advanced-studio`.
One combined commit retains the interdependent Image Studio, advanced engine,
privacy guards, UI and tests. No Phase 3.3 features are included.

## Features by phase

**Phase 3.2.2:** explicit Chat image generation and reference editing using the
configured OpenAI or OpenRouter image provider; inline authenticated previews
and downloads; immutable originals and revision chains; conversation-linked
image jobs and history; payload-bound idempotency, concurrency limits,
cancellation, numerical usage metadata and controlled provider errors. Image
operations remain separate from direct text Chat and governed Work execution.

**Phase 3.2.3:** optional local/trusted-remote ComfyUI; fixed SD 1.5/SDXL
text-to-image, img2img and inpainting templates; checkpoint/LoRA discovery with
reviewed metadata, family compatibility, bounded strengths, presets and default
selection; Canvas brush/erase/invert masks and original comparison; durable
remote prompt tracking, bounded progress and read-only recovery; opt-in Private
Studio with expiring server-validated access, isolated gallery, authenticated
media, visibility controls, logical deletion and explicit purge.

The main FastAPI/SQLite application requires no torch, CUDA, GPU, model downloads,
ComfyUI installation or additional heavy production dependencies.

## Executed validation

Executed locally on Linux:

| Suite | Exact result |
| --- | --- |
| Python 3.12.14 backend | 280 passed in 39.91s |
| Python 3.15.0 backend | 280 passed in 40.68s |
| Chromium integration | 13 tests in 33.413s, OK |

All provider responses
are mocked and databases, uploads and output images are disposable. No paid API
calls, real GPU inference or changes to existing user databases were performed.

The security review adds two WebSocket redirect regression cases beyond the
previous 278-case implementation. The pre-Image-Studio migration fixture now
also excludes the six advanced Studio tables, matching the actual older schema.

JavaScript syntax, workflow YAML, authenticated route declarations and staged
whitespace/artifact checks are checked separately. Full lint is not claimed.

## Additive migration verification

The combined change adds eight tables: `image_jobs`, `image_assets`,
`studio_workspaces`, `studio_unlocks`, `studio_attachments`, `studio_executions`,
`studio_lora_presets` and `studio_preferences`. Existing tables are not rebuilt
or rewritten. Existing ordinary assets are not reclassified as private.

Disposable populated legacy and Phase 3.2.2 fixtures verify schema and row
preservation, repeated startup and fresh-process reopen/access. Existing
conversation, agent, task, approval and audit regressions remain in the suite.
These fixture tests do not substitute for an operator backup of a real database.

## Focused security review

### Private Studio

- All 19 private route declarations depend on owner authentication, directly or
  through the private access dependency. Unlock requires the server enable flag
  and explicit boolean eligibility/policy attestations. Lock revokes stored
  sessions; token hashes, owner binding and expiry are checked server-side.
- Private images and uploads require an active unlock through dedicated routes.
  Ordinary conversation, Chat, upload, image, job and audit routes do not grant
  private access even when sent an unlock header. Private conversations are
  excluded from ordinary history and their image-job audit events are hidden.
- Sources, masks, results and immutable revisions must belong to the same owner
  and conversation. Privacy follows that immutable workspace relationship.
  Cross-workspace reference reuse and public/private reclassification are not
  exposed. Authenticated media uses no-store and raster/nosniff restrictions.
- The browser retains owner/unlock credentials in memory, clears private UI on
  lock/expiry/disconnect/hidden-page events, and rejects stale asynchronous
  updates. It does not persist them in localStorage, URLs or sessionStorage.
- Private prompts/images are absent from audit summaries. Errors avoid raw
  provider bodies and rejected validation payloads. Configured secrets and the
  active unlock token are redacted from generation prompts.
- Tombstones prevent new requests; writer-lock scope rechecks reject late
  uploads and generation after deletion. Purge retains active/uncertain files
  and cross-workspace references, never following symlinks.

Eligibility is **self-attestation**, not formal identity or age verification.
There is no semantic age/content classifier. Isolation applies to correctly
classified private workspaces. Deployment must satisfy applicable laws, consent,
checkpoint licenses and provider policies; private access overrides none of
them. This is not an age-assured public adult service.

Local storage is **unencrypted**. Logical purge is not forensic erasure of
SQLite/WAL, backups, remote engine outputs or already-downloaded client files.

### ComfyUI and model management

- ComfyUI is disabled by default. Only exact server-configured trusted origins
  are accepted. Non-loopback HTTP, URL credentials/path prefixes/query strings,
  link-local/metadata literals and traversal are rejected. HTTP and optional
  WebSocket redirects are rejected. Operators must control trusted host DNS,
  TLS and network egress; the adapter does not pin DNS answers.
- No proxy endpoint exposes ComfyUI itself. Keep the service on loopback or a
  protected GPU host; browser requests go through authenticated Luma routes.
- Browser schemas reject arbitrary workflows, nodes, URLs and model paths. Only
  code-defined graph templates and reviewed model identifiers can execute.
  UUID prompt IDs and remote upload/output filenames are validated.
- Safetensors extension, family, availability and reviewed SHA256/license/source
  metadata gate execution. Optional local-root SHA256 checking reads bounded
  chunks. Standard remote catalogs do not prove actual hashes, family or license:
  remote verification is explicitly operator-attested.
- LoRA selections have identifier patterns, duplicate checks, bounded finite
  strengths, family/model compatibility and per-request count limits. Image
  dimensions, pixels, steps, CFG, denoise, seed and batch are bounded. Unknown or
  incompatible combinations fail explicitly. No model downloading or model
  weight uploads/execution are provided.
- Private cloud use requires both server permission and per-request consent.
  There is no implicit engine fallback or automatic private-image transfer.

### Image processing, jobs and Work

- Upload and output bytes are bounded. Isolated raster parsing checks MIME
  signatures, dimensions, frame count and actual decoding, with a timeout;
  Unix resource limits are supplementary and unavailable on native Windows.
  Masks must be PNG and match source dimensions. Files use server UUID names,
  private storage and symlink/traversal checks. Originals remain immutable.
- Writer locks, payload fingerprints and persisted client IDs prevent duplicate
  chargeable execution. Global per-owner physical-call limits apply across
  conversations and remain held for uncertain native executions.
- Cancellation wins over late success/error. Targeted remote cancellation never
  uses a shared global interrupt or queue clear. Read-only recovery reconciles
  known prompt IDs without submitting another job. Queue absence must be
  authoritative; malformed/unavailable state stays uncertain. Recovery/monitor
  races cannot persist duplicate outputs or revive released slots.
- Work authentication, governance, task-specific approvals and executor source
  modules are unchanged. New image routes never authorize Work execution.

## Configuration and Windows setup

See [README](../README.md#phase-322--luma-office-ai-image-studio),
[advanced Windows setup](../README.md#windows-10-setup), [.env.example](../.env.example)
and the [disabled model manifest example](../examples/comfyui-manifest.example.json).

Start with `IMAGE_PROVIDER=unavailable`, `COMFYUI_ENABLED=false`,
`PRIVATE_STUDIO_ENABLED=false`, `PRIVATE_STUDIO_ALLOW_CLOUD=false`. Put actual
keys/tokens only in your private `.env`. Use separate disposable database and
media directories for acceptance testing. Normal startup needs no image engine.

Install ComfyUI separately only if needed. Bind it to loopback or a protected
GPU host, review licenses/metadata/hashes, configure exact trusted origins and
an operator-controlled manifest, then explicitly enable the desired engine.
Never open raw ComfyUI to untrusted clients. Private cloud transfer is a separate
opt-in; unsupported settings fail rather than silently falling back.

## CI and screenshots

The Windows workflow runs backend tests on Python 3.12 and 3.15 with no global
application environment overrides, preserving dotenv tests. A separate Ubuntu
Chromium job uses the disposable mock server and publishes the
`mocked-office-screenshots` artifact for 14 days. It contains generation/editing,
model-manager, inpainting and private locked/gallery screenshots. All output is
benign, clearly labeled mock artwork. No user images or screenshot binaries are
committed.

[Feature-branch workflow runs and screenshot artifacts](https://github.com/Nipzy12/LUMAVUN-Agent/actions/workflows/backend-windows.yml?query=branch%3Afeature%2Fphase-3.2.3-advanced-studio).
CI results and screenshot artifact availability must be confirmed on GitHub;
adding a workflow is not a claim that Windows or hosted CI already passed.

## Manual acceptance checklist

- [ ] Install into a disposable environment; leave all engines/private mode off
  and verify normal startup, `/office`, Chat and Work.
- [ ] Verify owner-less/wrong-owner image, catalog and private requests fail.
- [ ] With mock data or an explicitly approved live provider, generate once,
  refresh/reopen history, download, edit twice and verify preserved originals.
- [ ] Re-send the same client request and simulate interruption; confirm no
  duplicate chargeable call or automatic retry.
- [ ] Enable only a trusted ComfyUI instance and reviewed licensed SD/SDXL
  models; check unavailable models, incompatible LoRAs and excessive parameters.
- [ ] Test img2img and Canvas inpainting; reject mismatched masks and inspect
  immutable parents. Confirm image jobs cannot execute Work tasks.
- [ ] Cancel a running/queued job and reconcile after restart; verify no late
  result overwrite, shared interrupt or duplicate results.
- [ ] Opt into private mode with the required attestations. Generate benign
  test art; verify ordinary Chat/history/audit do not reveal it.
- [ ] Lock or expire the private session; request the exact asset/upload URL
  directly and confirm denial. Reconnect/unlock to reopen permitted history.
- [ ] Confirm private cloud transfer fails without both server and request
  consent; verify ordinary/private source mixing is rejected.
- [ ] Delete only the disposable workspace; purge after jobs stop. Verify
  pending/uncertain jobs retain their files and unrelated data is untouched.
- [ ] Verify the actual Windows 3.12/3.15 CI matrix, browser artifacts and
  optional real GPU/model behavior before deployment.

## Remaining limitations

Native Windows and actual GPU/checkpoint/cloud execution are unverified locally.
Only fixed SD 1.5/SDXL recipes are supported; no FLUX, ControlNet or arbitrary
custom nodes. Intermediate binary previews are not relayed. Remote hashes and
checkpoint licensing need operator verification. An uncertain/lost prompt ID or
unreachable engine may require operator inspection; cancellation cannot undo
remote computation or charges. Older ComfyUI versions may support local result
discard only. No global storage quota, gallery virtualization, encrypted media,
multi-user SSO or automatic age/content classification is included.

## Complete changed-file list

The combined branch changes the following 32 files:


- `.env.example`
- `.github/workflows/backend-windows.yml`
- `.gitignore`
- `README.md`
- `docs/phase-3.2.2-3.2.3-review.md`
- `examples/comfyui-manifest.example.json`
- `luma_core/app.py`
- `luma_core/config.py`
- `luma_core/memory/attachments.py`
- `luma_core/memory/conversations.py`
- `luma_core/memory/studio_privacy.py`
- `luma_core/models/__init__.py`
- `luma_core/models/images.py`
- `luma_core/models/studio.py`
- `luma_core/providers/comfyui.py`
- `luma_core/providers/images.py`
- `luma_core/providers/prompts.py`
- `luma_core/routers/chat.py`
- `luma_core/routers/conversations.py`
- `luma_core/routers/images.py`
- `luma_core/routers/private_studio.py`
- `luma_core/routers/studio.py`
- `luma_core/ui/__init__.py`
- `luma_core/ui/app.js`
- `luma_core/ui/index.html`
- `luma_core/ui/studio.js`
- `luma_core/ui/styles.css`
- `tests/browser_office.py`
- `tests/office_browser_server.py`
- `tests/test_advanced_studio.py`
- `tests/test_conversation_migration.py`
- `tests/test_image_studio.py`
