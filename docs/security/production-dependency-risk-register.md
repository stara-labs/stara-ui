# Production dependency risk register

Last reviewed: 2026-07-18

Scope: the Stara browser bundle and the pruned Node.js production runtime produced by
`Dockerfile` and `Dockerfile.multi`.

The required CI gate is:

```sh
npm run security:audit:production
```

It audits the complete production graph, including platform-specific optional packages,
and rejects high and critical advisories. Sharp distributes its required native runtime
through optional packages, so a blanket optional-dependency omission is not bootable.

## DEP-001: HyperDX OpenTelemetry baggage allocation

- Severity: moderate
- Advisory: `GHSA-8988-4f7v-96qf`
- Affected chain: `@hyperdx/browser` through browser OpenTelemetry instrumentation
- Disposition: temporarily accepted with controls
- Controls: RUM is disabled unless `RUM_ENABLED=true`; invalid or incomplete RUM
  configuration fails closed; replay, console capture, and advanced network capture
  default to disabled; production deployment does not configure RUM.
- Removal condition: upgrade when HyperDX publishes a release whose complete browser
  instrumentation graph resolves `@opentelemetry/core >=2.8.0`.
- Owner: Stara Engineering
- Review by: 2026-08-15, or immediately when HyperDX publishes a new browser release

## DEP-002: Monaco bundled DOMPurify

- Severity: low at the `monaco-editor` package and moderate in the nested sanitizer
- Advisories: `GHSA-76mc-f452-cxcm`, `GHSA-cmwh-pvxp-8882`,
  `GHSA-gvmj-g25r-r7wr`, `GHSA-hpcv-96wg-7vj8`, `GHSA-r47g-fvhr-h676`,
  `GHSA-rp9w-3fw7-7cwq`, `GHSA-vxr8-fq34-vvx9`, and
  `GHSA-x4vx-rjvf-j5p4`
- Affected chain: `monaco-editor@0.55.1`, the latest stable release, bundles an older
  DOMPurify implementation for its internal Markdown rendering
- Disposition: temporarily accepted with controls
- Controls: Stara's direct DOMPurify dependency is patched; Monaco is used only by
  the artifact code editor; Stara registers no custom hover provider that supplies
  untrusted HTML; Monaco sanitizes its internal Markdown output with a fixed allowlist.
- Removal condition: upgrade when Monaco ships a stable release containing a patched
  bundled DOMPurify implementation.
- Owner: Stara Engineering
- Review by: 2026-08-15, or immediately when Monaco publishes a new stable release

## DEP-003: Firebase Admin optional Storage UUID chain

- Severity: moderate
- Advisory: `GHSA-w5hq-g745-h8pq`
- Affected chain: `firebase-admin -> @google-cloud/storage -> teeny-request -> uuid@9`
- Disposition: temporarily accepted with controls
- Controls: Stara imports the `firebase-admin/auth` subpath and does not import the
  Firebase Storage API; production audit includes this chain; Docker runtime smoke
  loads Identity Platform auth and the complete `@librechat/api` runtime graph.
- Rationale: npm groups Firebase Admin's unused provider clients with Sharp's required
  native binaries as optional dependencies. Omitting all optionals prevents the API
  image from loading Sharp on Alpine Linux.
- Removal condition: upgrade when Firebase Admin's Storage dependency resolves
  `uuid >=11.1.1`, or adopt a selective install mechanism that preserves Sharp's native
  packages without shipping unused Firebase provider clients.
- Owner: Stara Engineering
- Review by: 2026-08-15, or immediately when Firebase Admin publishes a compatible fix
